use std::fmt;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{Device, ErrorKind, Sample, SampleFormat, Stream, StreamConfig};
use rtrb::{Consumer, Producer, RingBuffer};

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

#[derive(Debug, Clone, Copy)]
enum NativeSample {
    F32(f32),
    F64(f64),
    I64(i64),
    I32(i32),
    I24(cpal::I24),
    I16(i16),
    U8(u8),
}

impl NativeSample {
    fn normalized(self) -> f32 {
        match self {
            Self::F32(sample) if sample.is_finite() => sample.clamp(-1.0, 1.0),
            Self::F32(_) => 0.0,
            Self::F64(sample) if sample.is_finite() => sample.to_sample::<f32>().clamp(-1.0, 1.0),
            Self::F64(_) => 0.0,
            Self::I64(sample) => sample.to_sample::<f32>(),
            Self::I32(sample) => sample.to_sample::<f32>(),
            Self::I24(sample) => sample.to_sample::<f32>(),
            Self::I16(sample) => sample.to_sample::<f32>(),
            Self::U8(sample) => sample.to_sample::<f32>(),
        }
    }
}

pub struct WindowsSystemCapture {
    stream: Option<Stream>,
    muted: Arc<AtomicBool>,
    stop_requested: Arc<AtomicBool>,
    worker: Option<JoinHandle<Result<(), SystemCaptureWorkerError>>>,
}

impl WindowsSystemCapture {
    pub fn start(
        audio_sender: AudioFrameSender,
        echo_reference: EchoReferenceSender,
        dsp_control: DspControl,
        helper_started_at: Instant,
        dropped_audio_frames: Arc<AtomicU64>,
        control_events: ControlEventSender,
    ) -> Result<Self, WindowsSystemCaptureError> {
        let device = cpal::default_host()
            .default_output_device()
            .ok_or(WindowsSystemCaptureError::NoOutputDevice)?;
        let supported_config = device
            .default_output_config()
            .map_err(WindowsSystemCaptureError::QueryConfig)?;
        let sample_format = supported_config.sample_format();
        if !is_supported_sample_format(sample_format) {
            return Err(WindowsSystemCaptureError::UnsupportedSampleFormat(
                sample_format,
            ));
        }
        let config: StreamConfig = supported_config.into();
        if config.channels == 0 {
            return Err(WindowsSystemCaptureError::InvalidChannelCount(0));
        }
        if config.sample_rate == 0 {
            return Err(WindowsSystemCaptureError::InvalidSampleRate(0));
        }

        let channel_count = usize::from(config.channels);
        let requested_capacity = usize::try_from(config.sample_rate)
            .unwrap_or(usize::MAX)
            .saturating_mul(channel_count)
            / 2;
        let ring_capacity = requested_capacity.clamp(MIN_RING_SAMPLES, MAX_RING_SAMPLES);
        let (producer, consumer) = RingBuffer::new(ring_capacity);
        let stop_requested = Arc::new(AtomicBool::new(false));
        let muted = Arc::new(AtomicBool::new(false));
        let runtime_failed = Arc::new(AtomicBool::new(false));
        let discontinuity_pending = Arc::new(AtomicBool::new(false));
        let normalizer = StreamingResampler::new(config.sample_rate, AUDIO_SAMPLE_RATE_HZ)
            .map_err(|error| WindowsSystemCaptureError::CreateResampler(error.to_string()))?;
        let base_timestamp_us =
            u64::try_from(helper_started_at.elapsed().as_micros()).unwrap_or(u64::MAX);

        let stream = build_loopback_stream(
            &device,
            &config,
            sample_format,
            producer,
            Arc::clone(&runtime_failed),
            Arc::clone(&discontinuity_pending),
            dropped_audio_frames,
        )?;
        let worker_stop = Arc::clone(&stop_requested);
        let worker_muted = Arc::clone(&muted);
        let worker_runtime_failed = Arc::clone(&runtime_failed);
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
                    discontinuity_pending,
                );
                if matches!(result, Err(SystemCaptureWorkerError::RuntimeStreamFailure)) {
                    worker_control_events.report(system_audio_helper_error(
                        HelperErrorCode::DeviceDisconnected,
                        "System audio stopped responding. Recording will continue with the microphone only.",
                    ));
                }
                result
            })
            .map_err(WindowsSystemCaptureError::SpawnWorker)?;

        if let Err(source) = stream.play() {
            stop_requested.store(true, Ordering::Release);
            let _ = worker.join();
            return Err(WindowsSystemCaptureError::StartStream(source));
        }

        Ok(Self {
            stream: Some(stream),
            muted,
            stop_requested,
            worker: Some(worker),
        })
    }

    pub fn stop(mut self) -> Result<(), WindowsSystemCaptureError> {
        self.stop_inner()
    }

    pub fn set_muted(&self, muted: bool) {
        self.muted.store(muted, Ordering::Release);
    }

    fn stop_inner(&mut self) -> Result<(), WindowsSystemCaptureError> {
        self.stream.take();
        self.stop_requested.store(true, Ordering::Release);
        let Some(worker) = self.worker.take() else {
            return Ok(());
        };
        worker
            .join()
            .map_err(|_| WindowsSystemCaptureError::WorkerPanicked)?
            .map_err(WindowsSystemCaptureError::Worker)
    }
}

impl Drop for WindowsSystemCapture {
    fn drop(&mut self) {
        let _ = self.stop_inner();
    }
}

const fn is_supported_sample_format(format: SampleFormat) -> bool {
    matches!(
        format,
        SampleFormat::F32
            | SampleFormat::F64
            | SampleFormat::I64
            | SampleFormat::I32
            | SampleFormat::I24
            | SampleFormat::I16
            | SampleFormat::U8
    )
}

fn build_loopback_stream(
    device: &Device,
    config: &StreamConfig,
    sample_format: SampleFormat,
    producer: Producer<NativeSample>,
    runtime_failed: Arc<AtomicBool>,
    discontinuity_pending: Arc<AtomicBool>,
    dropped_audio_frames: Arc<AtomicU64>,
) -> Result<Stream, WindowsSystemCaptureError> {
    match sample_format {
        SampleFormat::F32 => build_typed_loopback_stream(
            device,
            config,
            producer,
            NativeSample::F32,
            runtime_failed,
            discontinuity_pending,
            dropped_audio_frames,
        ),
        SampleFormat::F64 => build_typed_loopback_stream(
            device,
            config,
            producer,
            NativeSample::F64,
            runtime_failed,
            discontinuity_pending,
            dropped_audio_frames,
        ),
        SampleFormat::I64 => build_typed_loopback_stream(
            device,
            config,
            producer,
            NativeSample::I64,
            runtime_failed,
            discontinuity_pending,
            dropped_audio_frames,
        ),
        SampleFormat::I32 => build_typed_loopback_stream(
            device,
            config,
            producer,
            NativeSample::I32,
            runtime_failed,
            discontinuity_pending,
            dropped_audio_frames,
        ),
        SampleFormat::I24 => build_typed_loopback_stream(
            device,
            config,
            producer,
            NativeSample::I24,
            runtime_failed,
            discontinuity_pending,
            dropped_audio_frames,
        ),
        SampleFormat::I16 => build_typed_loopback_stream(
            device,
            config,
            producer,
            NativeSample::I16,
            runtime_failed,
            discontinuity_pending,
            dropped_audio_frames,
        ),
        SampleFormat::U8 => build_typed_loopback_stream(
            device,
            config,
            producer,
            NativeSample::U8,
            runtime_failed,
            discontinuity_pending,
            dropped_audio_frames,
        ),
        format => Err(WindowsSystemCaptureError::UnsupportedSampleFormat(format)),
    }
}

fn build_typed_loopback_stream<T>(
    device: &Device,
    config: &StreamConfig,
    mut producer: Producer<NativeSample>,
    convert: fn(T) -> NativeSample,
    runtime_failed: Arc<AtomicBool>,
    discontinuity_pending: Arc<AtomicBool>,
    dropped_audio_frames: Arc<AtomicU64>,
) -> Result<Stream, WindowsSystemCaptureError>
where
    T: cpal::SizedSample + Copy + 'static,
{
    let callback_discontinuity = Arc::clone(&discontinuity_pending);
    let callback_dropped = Arc::clone(&dropped_audio_frames);
    let input_callback = move |data: &[T], _: &cpal::InputCallbackInfo| {
        if producer.slots() < data.len() {
            mark_discontinuity(&callback_discontinuity, &callback_dropped);
            return;
        }
        for &sample in data {
            if producer.push(convert(sample)).is_err() {
                mark_discontinuity(&callback_discontinuity, &callback_dropped);
                break;
            }
        }
    };
    let error_callback = move |error: cpal::Error| {
        if !matches!(
            error.kind(),
            ErrorKind::Xrun | ErrorKind::DeviceChanged | ErrorKind::RealtimeDenied
        ) {
            runtime_failed.store(true, Ordering::Release);
        }
        mark_discontinuity(&discontinuity_pending, &dropped_audio_frames);
    };

    // CPAL's WASAPI host recognizes this render endpoint and initializes the
    // input stream in shared AUDCLNT_STREAMFLAGS_LOOPBACK mode.
    device
        .build_input_stream(*config, input_callback, error_callback, None)
        .map_err(WindowsSystemCaptureError::BuildStream)
}

fn mark_discontinuity(discontinuity_pending: &AtomicBool, dropped_audio_frames: &AtomicU64) {
    discontinuity_pending.store(true, Ordering::Release);
    dropped_audio_frames.fetch_add(1, Ordering::Relaxed);
}

#[allow(clippy::too_many_arguments)]
fn run_capture_worker(
    mut consumer: Consumer<NativeSample>,
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
            return Err(SystemCaptureWorkerError::RuntimeStreamFailure);
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
            channel_sum += sample.normalized();
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
pub enum WindowsSystemCaptureError {
    NoOutputDevice,
    QueryConfig(cpal::Error),
    UnsupportedSampleFormat(SampleFormat),
    InvalidSampleRate(u32),
    InvalidChannelCount(u16),
    CreateResampler(String),
    BuildStream(cpal::Error),
    SpawnWorker(std::io::Error),
    StartStream(cpal::Error),
    WorkerPanicked,
    Worker(SystemCaptureWorkerError),
}

impl fmt::Display for WindowsSystemCaptureError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NoOutputDevice => formatter.write_str("no default system output is available"),
            Self::QueryConfig(error) => {
                write!(formatter, "failed to query system output format: {error}")
            }
            Self::UnsupportedSampleFormat(format) => {
                write!(
                    formatter,
                    "unsupported system output sample format {format}"
                )
            }
            Self::InvalidSampleRate(rate) => {
                write!(formatter, "invalid system output sample rate {rate}")
            }
            Self::InvalidChannelCount(channels) => {
                write!(formatter, "invalid system output channel count {channels}")
            }
            Self::CreateResampler(error) => {
                write!(
                    formatter,
                    "failed to create system audio resampler: {error}"
                )
            }
            Self::BuildStream(error) => {
                write!(formatter, "failed to build WASAPI loopback stream: {error}")
            }
            Self::SpawnWorker(error) => {
                write!(formatter, "failed to spawn system audio worker: {error}")
            }
            Self::StartStream(error) => {
                write!(formatter, "failed to start WASAPI loopback stream: {error}")
            }
            Self::WorkerPanicked => formatter.write_str("system audio worker panicked"),
            Self::Worker(error) => write!(formatter, "system audio worker failed: {error}"),
        }
    }
}

impl std::error::Error for WindowsSystemCaptureError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::QueryConfig(error) | Self::BuildStream(error) | Self::StartStream(error) => {
                Some(error)
            }
            Self::SpawnWorker(error) => Some(error),
            Self::Worker(error) => Some(error),
            Self::NoOutputDevice
            | Self::UnsupportedSampleFormat(_)
            | Self::InvalidSampleRate(_)
            | Self::InvalidChannelCount(_)
            | Self::CreateResampler(_)
            | Self::WorkerPanicked => None,
        }
    }
}

impl WindowsSystemCaptureError {
    pub fn to_helper_error(&self) -> HelperError {
        let (code, message) = match self {
            Self::NoOutputDevice => (
                HelperErrorCode::NoOutputDevice,
                "No system output is available. Recording will continue with the microphone only.",
            ),
            Self::QueryConfig(error) | Self::BuildStream(error) | Self::StartStream(error)
                if looks_like_permission_denied(error) =>
            {
                (
                    HelperErrorCode::PermissionDenied,
                    "System audio access is denied. Recording will continue with the microphone only.",
                )
            }
            _ => (
                HelperErrorCode::SystemAudioUnavailable,
                "System audio is unavailable. Recording will continue with the microphone only.",
            ),
        };
        system_audio_helper_error(code, message)
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

fn looks_like_permission_denied(error: &cpal::Error) -> bool {
    let message = error.to_string().to_ascii_lowercase();
    message.contains("permission")
        || message.contains("access denied")
        || message.contains("not permitted")
}

#[derive(Debug)]
pub enum SystemCaptureWorkerError {
    RuntimeStreamFailure,
    Resample(String),
    AudioProcessing(String),
    VoiceActivity(String),
    SendAudio(AudioFrameSendError),
}

impl fmt::Display for SystemCaptureWorkerError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::RuntimeStreamFailure => {
                formatter.write_str("WASAPI loopback stream reported a runtime failure")
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
            Self::RuntimeStreamFailure
            | Self::Resample(_)
            | Self::AudioProcessing(_)
            | Self::VoiceActivity(_) => None,
        }
    }
}
