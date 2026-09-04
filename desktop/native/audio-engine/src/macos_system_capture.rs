use std::fmt;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use orion_macos_system_audio::{ProcessTap, TapError};
use rtrb::{Consumer, RingBuffer};

use crate::audio_codec::{AUDIO_SAMPLE_RATE_HZ, AudioFrame, AudioFrameFlags, VoiceActivity};
use crate::audio_frame_mux::{AudioFrameSendError, AudioFrameSender};
use crate::control_loop::ControlEventSender;
use crate::dsp_control::DspControl;
use crate::protocol::{AudioSource, DspConfiguration, HelperError, HelperErrorCode};
use crate::source_audio_processing::{
    EchoReferenceSender, SourceAudioProcessingConfig, SourceAudioProcessor,
};
use crate::streaming_resampler::StreamingResampler;
use crate::voice_activity::{VoiceActivityAnnotator, VoiceActivityConfig};

const WIRE_CHUNK_FRAMES: usize = 2_880;
const MIN_RING_SAMPLES: usize = 16_384;
const MAX_RING_SAMPLES: usize = 1_000_000;
const MAX_SAMPLES_PER_WORKER_BATCH: usize = 16_384;
const IDLE_POLL_INTERVAL: Duration = Duration::from_millis(1);

pub struct MacOsSystemCapture {
    tap: Option<ProcessTap>,
    muted: Arc<AtomicBool>,
    stop_requested: Arc<AtomicBool>,
    worker: Option<JoinHandle<Result<(), SystemCaptureWorkerError>>>,
}

impl MacOsSystemCapture {
    pub fn start(
        audio_sender: AudioFrameSender,
        echo_reference: EchoReferenceSender,
        dsp_control: DspControl,
        helper_started_at: Instant,
        dropped_audio_frames: Arc<AtomicU64>,
        control_events: ControlEventSender,
    ) -> Result<Self, MacOsSystemCaptureError> {
        let mut tap = ProcessTap::create().map_err(MacOsSystemCaptureError::CreateTap)?;
        let format = tap.format();
        let channel_count = usize::try_from(format.channels)
            .map_err(|_| MacOsSystemCaptureError::InvalidChannelCount(format.channels))?;
        let requested_capacity = usize::try_from(format.sample_rate)
            .unwrap_or(usize::MAX)
            .saturating_mul(channel_count)
            / 2;
        let ring_capacity = requested_capacity.clamp(MIN_RING_SAMPLES, MAX_RING_SAMPLES);
        let (producer, consumer) = RingBuffer::new(ring_capacity);
        let stop_requested = Arc::new(AtomicBool::new(false));
        let muted = Arc::new(AtomicBool::new(false));
        let runtime_failed = Arc::new(AtomicBool::new(false));
        let discontinuity_pending = Arc::new(AtomicBool::new(false));
        let normalizer = StreamingResampler::new(format.sample_rate, AUDIO_SAMPLE_RATE_HZ)
            .map_err(|error| MacOsSystemCaptureError::CreateResampler(error.to_string()))?;
        let base_timestamp_us =
            u64::try_from(helper_started_at.elapsed().as_micros()).unwrap_or(u64::MAX);

        let worker_stop = Arc::clone(&stop_requested);
        let worker_muted = Arc::clone(&muted);
        let worker_runtime_failed = Arc::clone(&runtime_failed);
        let worker_discontinuity = Arc::clone(&discontinuity_pending);
        let worker_control_events = control_events;
        let worker = thread::Builder::new()
            .name("orion-system-audio-worker".to_owned())
            .spawn(move || {
                let result = run_capture_worker(
                    consumer,
                    audio_sender,
                    echo_reference,
                    dsp_control,
                    normalizer,
                    channel_count,
                    base_timestamp_us,
                    worker_muted,
                    worker_stop,
                    worker_runtime_failed,
                    worker_discontinuity,
                );
                if matches!(result, Err(SystemCaptureWorkerError::RuntimeTapFailure)) {
                    worker_control_events.report(system_audio_helper_error(
                        HelperErrorCode::DeviceDisconnected,
                        "System audio stopped responding. Recording will continue with the microphone only.",
                    ));
                }
                result
            })
            .map_err(MacOsSystemCaptureError::SpawnWorker)?;

        if let Err(error) = tap.start(
            producer,
            Arc::clone(&runtime_failed),
            discontinuity_pending,
            dropped_audio_frames,
        ) {
            stop_requested.store(true, Ordering::Release);
            let _ = worker.join();
            return Err(MacOsSystemCaptureError::StartTap(error));
        }

        Ok(Self {
            tap: Some(tap),
            muted,
            stop_requested,
            worker: Some(worker),
        })
    }

    pub fn stop(mut self) -> Result<(), MacOsSystemCaptureError> {
        self.stop_inner()
    }

    pub fn set_muted(&self, muted: bool) {
        self.muted.store(muted, Ordering::Release);
    }

    fn stop_inner(&mut self) -> Result<(), MacOsSystemCaptureError> {
        let tap_result = self
            .tap
            .take()
            .map(ProcessTap::stop)
            .transpose()
            .map_err(MacOsSystemCaptureError::StopTap);
        self.stop_requested.store(true, Ordering::Release);
        let worker_result = self.worker.take().map_or(Ok(()), |worker| {
            worker
                .join()
                .map_err(|_| MacOsSystemCaptureError::WorkerPanicked)?
                .map_err(MacOsSystemCaptureError::Worker)
        });
        tap_result?;
        worker_result
    }
}

impl Drop for MacOsSystemCapture {
    fn drop(&mut self) {
        let _ = self.stop_inner();
    }
}

#[allow(clippy::too_many_arguments)]
fn run_capture_worker(
    mut consumer: Consumer<f32>,
    audio_sender: AudioFrameSender,
    echo_reference: EchoReferenceSender,
    dsp_control: DspControl,
    mut normalizer: StreamingResampler,
    channel_count: usize,
    base_timestamp_us: u64,
    muted: Arc<AtomicBool>,
    stop_requested: Arc<AtomicBool>,
    runtime_failed: Arc<AtomicBool>,
    discontinuity_pending: Arc<AtomicBool>,
) -> Result<(), SystemCaptureWorkerError> {
    let mut assembler = SystemFrameAssembler::new(
        audio_sender,
        echo_reference,
        dsp_control,
        base_timestamp_us,
        muted,
        Arc::clone(&discontinuity_pending),
    );
    let mut channel_sum = 0.0_f32;
    let mut channel_index = 0_usize;
    let mut reset_for_discontinuity = false;

    loop {
        if runtime_failed.load(Ordering::Acquire) {
            return Err(SystemCaptureWorkerError::RuntimeTapFailure);
        }

        let discontinuous = discontinuity_pending.load(Ordering::Acquire);
        if discontinuous && !reset_for_discontinuity {
            assembler.reset_voice_activity()?;
            normalizer.reset();
            channel_sum = 0.0;
            channel_index = 0;
            reset_for_discontinuity = true;
        } else if !discontinuous {
            reset_for_discontinuity = false;
        }

        let mut processed = 0;
        while processed < MAX_SAMPLES_PER_WORKER_BATCH {
            let Ok(sample) = consumer.pop() else {
                break;
            };
            processed += 1;
            channel_sum += if sample.is_finite() {
                sample.clamp(-1.0, 1.0)
            } else {
                0.0
            };
            channel_index += 1;
            if channel_index == channel_count {
                let mono = channel_sum / channel_count as f32;
                let output = normalizer
                    .push(mono)
                    .map_err(|error| SystemCaptureWorkerError::Resample(error.to_string()))?;
                for &sample in output {
                    assembler.push(sample)?;
                }
                channel_sum = 0.0;
                channel_index = 0;
            }
        }

        if stop_requested.load(Ordering::Acquire) && consumer.is_empty() {
            break;
        }
        if processed == 0 {
            thread::sleep(IDLE_POLL_INTERVAL);
        } else {
            thread::yield_now();
        }
    }

    let drained = normalizer
        .finish()
        .map_err(|error| SystemCaptureWorkerError::Resample(error.to_string()))?;
    for sample in drained {
        assembler.push(sample)?;
    }
    assembler.finish()
}

struct SystemFrameAssembler {
    sender: AudioFrameSender,
    samples: Vec<i16>,
    sum_squares: f64,
    sequence: u64,
    emitted_samples: u64,
    base_timestamp_us: u64,
    muted: Arc<AtomicBool>,
    frame_muted: bool,
    discontinuity_pending: Arc<AtomicBool>,
    echo_reference: EchoReferenceSender,
    dsp_control: DspControl,
    applied_dsp: DspConfiguration,
    audio_processing: SourceAudioProcessor,
    voice_activity: VoiceActivityAnnotator,
}

impl SystemFrameAssembler {
    fn new(
        sender: AudioFrameSender,
        echo_reference: EchoReferenceSender,
        dsp_control: DspControl,
        base_timestamp_us: u64,
        muted: Arc<AtomicBool>,
        discontinuity_pending: Arc<AtomicBool>,
    ) -> Self {
        let frame_muted = muted.load(Ordering::Acquire);
        let applied_dsp = dsp_control.configuration();
        Self {
            sender,
            samples: Vec::with_capacity(WIRE_CHUNK_FRAMES),
            sum_squares: 0.0,
            sequence: 0,
            emitted_samples: 0,
            base_timestamp_us,
            muted,
            frame_muted,
            discontinuity_pending,
            echo_reference,
            dsp_control,
            applied_dsp,
            audio_processing: SourceAudioProcessor::new(
                AudioSource::System,
                system_processing_config(applied_dsp),
            ),
            voice_activity: VoiceActivityAnnotator::new(voice_activity_config(applied_dsp)),
        }
    }

    fn push(&mut self, sample: f32) -> Result<(), SystemCaptureWorkerError> {
        let muted = self.muted.load(Ordering::Acquire);
        if muted != self.frame_muted && !self.samples.is_empty() {
            if muted {
                self.frame_muted = true;
                self.samples.fill(0);
                self.sum_squares = 0.0;
            }
            self.flush_frame()?;
        }
        self.frame_muted = muted;
        let normalized = if muted {
            0.0
        } else if sample.is_finite() {
            sample.clamp(-1.0, 1.0)
        } else {
            0.0
        };
        self.samples.push(float_to_pcm16(normalized));
        self.sum_squares += f64::from(normalized) * f64::from(normalized);
        if self.samples.len() == WIRE_CHUNK_FRAMES {
            self.flush_frame()?;
        }
        Ok(())
    }

    fn finish(mut self) -> Result<(), SystemCaptureWorkerError> {
        if !self.samples.is_empty() {
            self.flush_frame()?;
        }
        for frame in self.voice_activity.finish() {
            self.sender
                .submit(frame)
                .map_err(SystemCaptureWorkerError::SendAudio)?;
        }
        Ok(())
    }

    fn flush_frame(&mut self) -> Result<(), SystemCaptureWorkerError> {
        self.apply_dsp_configuration()?;
        let sample_count = self.samples.len();
        let rms = (self.sum_squares / sample_count as f64).sqrt() as f32;
        let timestamp_offset_us =
            self.emitted_samples.saturating_mul(1_000_000) / u64::from(AUDIO_SAMPLE_RATE_HZ);
        let mut flags = if self.discontinuity_pending.swap(false, Ordering::AcqRel) {
            AudioFrameFlags::DISCONTINUITY
        } else {
            AudioFrameFlags::empty()
        };
        if self.frame_muted {
            flags = flags.union(AudioFrameFlags::MUTED);
        }
        let mut frame = AudioFrame {
            source: AudioSource::System,
            sequence: self.sequence,
            timestamp_us: self.base_timestamp_us.saturating_add(timestamp_offset_us),
            voice_activity: VoiceActivity::Unknown,
            rms,
            flags,
            samples: std::mem::replace(&mut self.samples, Vec::with_capacity(WIRE_CHUNK_FRAMES)),
        };
        self.echo_reference
            .submit(&frame)
            .map_err(|error| SystemCaptureWorkerError::AudioProcessing(error.to_string()))?;
        self.audio_processing
            .process(&mut frame)
            .map_err(|error| SystemCaptureWorkerError::AudioProcessing(error.to_string()))?;
        self.dsp_control.publish(
            AudioSource::System,
            self.audio_processing
                .telemetry(self.applied_dsp.voice_activity_detection),
        );
        if let Some(frame) = self
            .voice_activity
            .push(frame)
            .map_err(|error| SystemCaptureWorkerError::VoiceActivity(error.to_string()))?
        {
            self.sender
                .submit(frame)
                .map_err(SystemCaptureWorkerError::SendAudio)?;
        }
        self.sequence = self.sequence.saturating_add(1);
        self.emitted_samples = self.emitted_samples.saturating_add(sample_count as u64);
        self.sum_squares = 0.0;
        Ok(())
    }

    fn apply_dsp_configuration(&mut self) -> Result<(), SystemCaptureWorkerError> {
        let configuration = self.dsp_control.configuration();
        if configuration == self.applied_dsp {
            return Ok(());
        }
        for frame in self
            .voice_activity
            .reconfigure(voice_activity_config(configuration))
        {
            self.sender
                .submit(frame)
                .map_err(SystemCaptureWorkerError::SendAudio)?;
        }
        self.audio_processing
            .reconfigure(system_processing_config(configuration));
        self.applied_dsp = configuration;
        Ok(())
    }

    fn reset_voice_activity(&mut self) -> Result<(), SystemCaptureWorkerError> {
        for frame in self.voice_activity.reset() {
            self.sender
                .submit(frame)
                .map_err(SystemCaptureWorkerError::SendAudio)?;
        }
        self.audio_processing.reset();
        Ok(())
    }
}

fn system_processing_config(configuration: DspConfiguration) -> SourceAudioProcessingConfig {
    let mut config = SourceAudioProcessingConfig::for_source(AudioSource::System);
    config.automatic_gain_control = configuration.automatic_gain_control;
    config
}

fn voice_activity_config(configuration: DspConfiguration) -> VoiceActivityConfig {
    VoiceActivityConfig {
        enabled: configuration.voice_activity_detection,
        ..VoiceActivityConfig::default()
    }
}

fn float_to_pcm16(sample: f32) -> i16 {
    if sample <= -1.0 {
        i16::MIN
    } else {
        (sample * f32::from(i16::MAX)).round() as i16
    }
}

#[derive(Debug)]
pub enum MacOsSystemCaptureError {
    CreateTap(TapError),
    StartTap(TapError),
    StopTap(TapError),
    InvalidChannelCount(u32),
    CreateResampler(String),
    SpawnWorker(std::io::Error),
    WorkerPanicked,
    Worker(SystemCaptureWorkerError),
}

impl fmt::Display for MacOsSystemCaptureError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::CreateTap(error) => write!(formatter, "failed to create Core Audio tap: {error}"),
            Self::StartTap(error) => write!(formatter, "failed to start Core Audio tap: {error}"),
            Self::StopTap(error) => write!(formatter, "failed to stop Core Audio tap: {error}"),
            Self::InvalidChannelCount(channels) => {
                write!(formatter, "invalid Core Audio tap channel count {channels}")
            }
            Self::CreateResampler(error) => {
                write!(
                    formatter,
                    "failed to create system audio resampler: {error}"
                )
            }
            Self::SpawnWorker(error) => {
                write!(formatter, "failed to spawn system audio worker: {error}")
            }
            Self::WorkerPanicked => formatter.write_str("system audio worker panicked"),
            Self::Worker(error) => write!(formatter, "system audio worker failed: {error}"),
        }
    }
}

impl std::error::Error for MacOsSystemCaptureError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::CreateTap(error) | Self::StartTap(error) | Self::StopTap(error) => Some(error),
            Self::SpawnWorker(error) => Some(error),
            Self::Worker(error) => Some(error),
            Self::InvalidChannelCount(_) | Self::CreateResampler(_) | Self::WorkerPanicked => None,
        }
    }
}

impl MacOsSystemCaptureError {
    pub fn to_helper_error(&self) -> HelperError {
        let permission_denied = match self {
            Self::CreateTap(error) | Self::StartTap(error) | Self::StopTap(error) => {
                error.is_permission_denied()
            }
            _ => false,
        };
        if permission_denied {
            return system_audio_helper_error(
                HelperErrorCode::PermissionDenied,
                "System audio access is denied. Recording will continue with the microphone only. Allow access in System Settings for future recordings.",
            );
        }
        system_audio_helper_error(
            HelperErrorCode::SystemAudioUnavailable,
            "System audio is unavailable. Recording will continue with the microphone only.",
        )
    }
}

fn system_audio_helper_error(code: HelperErrorCode, message: &str) -> HelperError {
    HelperError {
        code,
        message: message.to_owned(),
        recoverable: true,
        source: Some(AudioSource::System),
    }
}

#[derive(Debug)]
pub enum SystemCaptureWorkerError {
    RuntimeTapFailure,
    Resample(String),
    AudioProcessing(String),
    VoiceActivity(String),
    SendAudio(AudioFrameSendError),
}

impl fmt::Display for SystemCaptureWorkerError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::RuntimeTapFailure => {
                formatter.write_str("Core Audio tap callback reported a runtime failure")
            }
            Self::Resample(error) => write!(formatter, "system audio resampling failed: {error}"),
            Self::AudioProcessing(error) => {
                write!(formatter, "system audio processing failed: {error}")
            }
            Self::VoiceActivity(error) => {
                write!(
                    formatter,
                    "system audio voice activity detection failed: {error}"
                )
            }
            Self::SendAudio(error) => write!(formatter, "system audio submit failed: {error}"),
        }
    }
}

impl std::error::Error for SystemCaptureWorkerError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::SendAudio(error) => Some(error),
            Self::RuntimeTapFailure
            | Self::Resample(_)
            | Self::AudioProcessing(_)
            | Self::VoiceActivity(_) => None,
        }
    }
}
