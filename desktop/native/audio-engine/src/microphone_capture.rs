use std::fmt;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{Device, ErrorKind, SampleFormat, Stream, StreamConfig, SupportedStreamConfig};
use rtrb::{Consumer, Producer, RingBuffer};

use crate::audio_codec::{AUDIO_SAMPLE_RATE_HZ, AudioFrame, AudioFrameFlags, VoiceActivity};
use crate::audio_frame_mux::{AudioFrameSendError, AudioFrameSender};
use crate::control_loop::ControlEventSender;
use crate::dsp_control::DspControl;
use crate::protocol::{AudioSource, DspConfiguration, HelperError, HelperErrorCode};
use crate::source_audio_processing::EchoReferenceReceiver;
use crate::source_audio_processing::{SourceAudioProcessingConfig, SourceAudioProcessor};
use crate::streaming_resampler::StreamingResampler;
use crate::voice_activity::{VoiceActivityAnnotator, VoiceActivityConfig};

const WIRE_CHUNK_FRAMES: usize = 2_880;
const MIN_RING_SAMPLES: usize = 16_384;
const MAX_RING_SAMPLES: usize = 1_000_000;
const IDLE_POLL_INTERVAL: Duration = Duration::from_millis(1);
const MAX_SAMPLES_PER_WORKER_BATCH: usize = 16_384;

#[derive(Debug, Clone, Copy)]
enum NativeSample {
    F32(f32),
    I16(i16),
    U16(u16),
}

impl NativeSample {
    fn normalized(self) -> f32 {
        match self {
            Self::F32(sample) if sample.is_finite() => sample.clamp(-1.0, 1.0),
            Self::F32(_) => 0.0,
            Self::I16(sample) => f32::from(sample) / 32_768.0,
            Self::U16(sample) => (f32::from(sample) - 32_768.0) / 32_768.0,
        }
    }
}

pub struct MicrophoneCapture {
    stream: Option<Stream>,
    muted: Arc<AtomicBool>,
    stop_requested: Arc<AtomicBool>,
    worker: Option<JoinHandle<Result<(), CaptureWorkerError>>>,
}

impl MicrophoneCapture {
    pub fn start(
        audio_sender: AudioFrameSender,
        echo_reference: EchoReferenceReceiver,
        dsp_control: DspControl,
        helper_started_at: Instant,
        dropped_audio_frames: Arc<AtomicU64>,
        control_events: ControlEventSender,
    ) -> Result<Self, MicrophoneCaptureError> {
        let host = cpal::default_host();
        let device = host
            .default_input_device()
            .ok_or(MicrophoneCaptureError::NoInputDevice)?;
        let supported_config = select_input_config(&device)?;
        let sample_format = supported_config.sample_format();
        let config: StreamConfig = supported_config.into();
        if config.channels == 0 {
            return Err(MicrophoneCaptureError::InvalidChannelCount(0));
        }

        let channel_count = usize::from(config.channels);
        let input_sample_rate = config.sample_rate;
        let requested_capacity = usize::try_from(input_sample_rate)
            .unwrap_or(usize::MAX)
            .saturating_mul(channel_count)
            / 2;
        let ring_capacity = requested_capacity.clamp(MIN_RING_SAMPLES, MAX_RING_SAMPLES);
        let (producer, consumer) = RingBuffer::new(ring_capacity);
        let stop_requested = Arc::new(AtomicBool::new(false));
        let muted = Arc::new(AtomicBool::new(false));
        let runtime_failed = Arc::new(AtomicBool::new(false));
        let discontinuity_pending = Arc::new(AtomicBool::new(false));
        if input_sample_rate == 0 {
            return Err(MicrophoneCaptureError::InvalidSampleRate(0));
        }
        let normalizer = StreamingResampler::new(input_sample_rate, AUDIO_SAMPLE_RATE_HZ)
            .map_err(|error| MicrophoneCaptureError::CreateResampler(error.to_string()))?;
        let base_timestamp_us =
            u64::try_from(helper_started_at.elapsed().as_micros()).unwrap_or(u64::MAX);

        let stream = build_input_stream(
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
            .name("orion-microphone-worker".to_owned())
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
                if matches!(result, Err(CaptureWorkerError::RuntimeStreamFailure)) {
                    worker_control_events.report(HelperError {
                        code: HelperErrorCode::DeviceDisconnected,
                        message:
                            "The microphone stopped responding. Stop to keep the partial recording."
                                .to_owned(),
                        recoverable: true,
                        source: Some(AudioSource::Mic),
                    });
                }
                result
            })
            .map_err(MicrophoneCaptureError::SpawnWorker)?;

        if let Err(source) = stream.play() {
            stop_requested.store(true, Ordering::Release);
            let _ = worker.join();
            return Err(MicrophoneCaptureError::StartStream(source));
        }

        Ok(Self {
            stream: Some(stream),
            muted,
            stop_requested,
            worker: Some(worker),
        })
    }

    pub fn set_muted(&self, muted: bool) {
        self.muted.store(muted, Ordering::Release);
    }

    pub fn stop(mut self) -> Result<(), MicrophoneCaptureError> {
        self.stop_inner()
    }

    fn stop_inner(&mut self) -> Result<(), MicrophoneCaptureError> {
        self.stream.take();
        self.stop_requested.store(true, Ordering::Release);
        let Some(worker) = self.worker.take() else {
            return Ok(());
        };
        worker
            .join()
            .map_err(|_| MicrophoneCaptureError::WorkerPanicked)?
            .map_err(MicrophoneCaptureError::Worker)
    }
}

impl Drop for MicrophoneCapture {
    fn drop(&mut self) {
        let _ = self.stop_inner();
    }
}

fn select_input_config(device: &Device) -> Result<SupportedStreamConfig, MicrophoneCaptureError> {
    let default_config = device
        .default_input_config()
        .map_err(MicrophoneCaptureError::QueryConfig)?;
    if is_supported_sample_format(default_config.sample_format()) {
        return Ok(default_config);
    }

    let configs = device
        .supported_input_configs()
        .map_err(MicrophoneCaptureError::QueryConfig)?;
    configs
        .filter(|config| is_supported_sample_format(config.sample_format()))
        .filter_map(|config| {
            config
                .try_with_sample_rate(AUDIO_SAMPLE_RATE_HZ)
                .or_else(|| config.try_with_sample_rate(44_100))
                .or_else(|| Some(config.with_max_sample_rate()))
        })
        .max_by(compare_input_configs)
        .ok_or(MicrophoneCaptureError::NoSupportedInputConfig)
}

fn compare_input_configs(
    left: &SupportedStreamConfig,
    right: &SupportedStreamConfig,
) -> std::cmp::Ordering {
    input_config_score(left).cmp(&input_config_score(right))
}

fn input_config_score(config: &SupportedStreamConfig) -> (bool, bool, u8, std::cmp::Reverse<u16>) {
    (
        config.sample_rate() == AUDIO_SAMPLE_RATE_HZ,
        config.channels() == 1,
        sample_format_score(config.sample_format()),
        std::cmp::Reverse(config.channels()),
    )
}

const fn sample_format_score(format: SampleFormat) -> u8 {
    match format {
        SampleFormat::F32 => 3,
        SampleFormat::I16 => 2,
        SampleFormat::U16 => 1,
        _ => 0,
    }
}

const fn is_supported_sample_format(format: SampleFormat) -> bool {
    matches!(
        format,
        SampleFormat::F32 | SampleFormat::I16 | SampleFormat::U16
    )
}

fn build_input_stream(
    device: &Device,
    config: &StreamConfig,
    sample_format: SampleFormat,
    producer: Producer<NativeSample>,
    runtime_failed: Arc<AtomicBool>,
    discontinuity_pending: Arc<AtomicBool>,
    dropped_audio_frames: Arc<AtomicU64>,
) -> Result<Stream, MicrophoneCaptureError> {
    match sample_format {
        SampleFormat::F32 => build_typed_input_stream(
            device,
            config,
            producer,
            NativeSample::F32,
            runtime_failed,
            discontinuity_pending,
            dropped_audio_frames,
        ),
        SampleFormat::I16 => build_typed_input_stream(
            device,
            config,
            producer,
            NativeSample::I16,
            runtime_failed,
            discontinuity_pending,
            dropped_audio_frames,
        ),
        SampleFormat::U16 => build_typed_input_stream(
            device,
            config,
            producer,
            NativeSample::U16,
            runtime_failed,
            discontinuity_pending,
            dropped_audio_frames,
        ),
        format => Err(MicrophoneCaptureError::UnsupportedSampleFormat(format)),
    }
}

fn build_typed_input_stream<T>(
    device: &Device,
    config: &StreamConfig,
    mut producer: Producer<NativeSample>,
    convert: fn(T) -> NativeSample,
    runtime_failed: Arc<AtomicBool>,
    discontinuity_pending: Arc<AtomicBool>,
    dropped_audio_frames: Arc<AtomicU64>,
) -> Result<Stream, MicrophoneCaptureError>
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
    device
        .build_input_stream(*config, input_callback, error_callback, None)
        .map_err(MicrophoneCaptureError::BuildStream)
}

fn mark_discontinuity(discontinuity_pending: &AtomicBool, dropped_audio_frames: &AtomicU64) {
    discontinuity_pending.store(true, Ordering::Release);
    dropped_audio_frames.fetch_add(1, Ordering::Relaxed);
}

#[allow(clippy::too_many_arguments)]
fn run_capture_worker(
    mut consumer: Consumer<NativeSample>,
    audio_sender: AudioFrameSender,
    echo_reference: EchoReferenceReceiver,
    dsp_control: DspControl,
    mut normalizer: StreamingResampler,
    channel_count: usize,
    base_timestamp_us: u64,
    muted: Arc<AtomicBool>,
    stop_requested: Arc<AtomicBool>,
    runtime_failed: Arc<AtomicBool>,
    discontinuity_pending: Arc<AtomicBool>,
) -> Result<(), CaptureWorkerError> {
    let mut assembler = AudioFrameAssembler::new(
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
            return Err(CaptureWorkerError::RuntimeStreamFailure);
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
                    .map_err(|error| CaptureWorkerError::Resample(error.to_string()))?;
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
        .map_err(|error| CaptureWorkerError::Resample(error.to_string()))?;
    for sample in drained {
        assembler.push(sample)?;
    }
    assembler.finish()
}

struct AudioFrameAssembler {
    sender: AudioFrameSender,
    samples: Vec<i16>,
    sum_squares: f64,
    sequence: u64,
    emitted_samples: u64,
    base_timestamp_us: u64,
    muted: Arc<AtomicBool>,
    frame_muted: bool,
    discontinuity_pending: Arc<AtomicBool>,
    dsp_control: DspControl,
    applied_dsp: DspConfiguration,
    audio_processing: SourceAudioProcessor,
    voice_activity: VoiceActivityAnnotator,
}

impl AudioFrameAssembler {
    fn new(
        sender: AudioFrameSender,
        echo_reference: EchoReferenceReceiver,
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
            dsp_control,
            applied_dsp,
            audio_processing: SourceAudioProcessor::new_microphone(
                microphone_processing_config(applied_dsp),
                echo_reference,
            ),
            voice_activity: VoiceActivityAnnotator::new(voice_activity_config(applied_dsp)),
        }
    }

    fn push(&mut self, sample: f32) -> Result<(), CaptureWorkerError> {
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

    fn finish(mut self) -> Result<(), CaptureWorkerError> {
        if !self.samples.is_empty() {
            self.flush_frame()?;
        }
        for frame in self.voice_activity.finish() {
            self.sender
                .submit(frame)
                .map_err(CaptureWorkerError::SendAudio)?;
        }
        Ok(())
    }

    fn flush_frame(&mut self) -> Result<(), CaptureWorkerError> {
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
            source: AudioSource::Mic,
            sequence: self.sequence,
            timestamp_us: self.base_timestamp_us.saturating_add(timestamp_offset_us),
            voice_activity: VoiceActivity::Unknown,
            rms,
            flags,
            samples: std::mem::replace(&mut self.samples, Vec::with_capacity(WIRE_CHUNK_FRAMES)),
        };
        self.audio_processing
            .process(&mut frame)
            .map_err(|error| CaptureWorkerError::AudioProcessing(error.to_string()))?;
        self.dsp_control.publish(
            AudioSource::Mic,
            self.audio_processing
                .telemetry(self.applied_dsp.voice_activity_detection),
        );
        if let Some(frame) = self
            .voice_activity
            .push(frame)
            .map_err(|error| CaptureWorkerError::VoiceActivity(error.to_string()))?
        {
            self.sender
                .submit(frame)
                .map_err(CaptureWorkerError::SendAudio)?;
        }
        self.sequence = self.sequence.saturating_add(1);
        self.emitted_samples = self.emitted_samples.saturating_add(sample_count as u64);
        self.sum_squares = 0.0;
        Ok(())
    }

    fn apply_dsp_configuration(&mut self) -> Result<(), CaptureWorkerError> {
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
                .map_err(CaptureWorkerError::SendAudio)?;
        }
        self.audio_processing
            .reconfigure(microphone_processing_config(configuration));
        self.applied_dsp = configuration;
        Ok(())
    }

    fn reset_voice_activity(&mut self) -> Result<(), CaptureWorkerError> {
        for frame in self.voice_activity.reset() {
            self.sender
                .submit(frame)
                .map_err(CaptureWorkerError::SendAudio)?;
        }
        self.audio_processing.reset();
        Ok(())
    }
}

fn microphone_processing_config(configuration: DspConfiguration) -> SourceAudioProcessingConfig {
    let mut config = SourceAudioProcessingConfig::for_source(AudioSource::Mic);
    config.automatic_gain_control = configuration.automatic_gain_control;
    config.noise_suppression = configuration.noise_suppression;
    config.echo_cancellation = configuration.echo_cancellation;
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
pub enum MicrophoneCaptureError {
    NoInputDevice,
    QueryConfig(cpal::Error),
    NoSupportedInputConfig,
    UnsupportedSampleFormat(SampleFormat),
    InvalidSampleRate(u32),
    InvalidChannelCount(u16),
    CreateResampler(String),
    BuildStream(cpal::Error),
    SpawnWorker(std::io::Error),
    StartStream(cpal::Error),
    WorkerPanicked,
    Worker(CaptureWorkerError),
}

impl fmt::Display for MicrophoneCaptureError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NoInputDevice => formatter.write_str("no default microphone is available"),
            Self::QueryConfig(error) => {
                write!(formatter, "failed to query microphone format: {error}")
            }
            Self::NoSupportedInputConfig => formatter
                .write_str("microphone does not expose an f32, i16, or u16 input configuration"),
            Self::UnsupportedSampleFormat(format) => {
                write!(formatter, "unsupported microphone sample format {format}")
            }
            Self::InvalidSampleRate(rate) => {
                write!(formatter, "invalid microphone sample rate {rate}")
            }
            Self::InvalidChannelCount(channels) => {
                write!(formatter, "invalid microphone channel count {channels}")
            }
            Self::CreateResampler(error) => {
                write!(formatter, "failed to create microphone resampler: {error}")
            }
            Self::BuildStream(error) => {
                write!(formatter, "failed to build microphone stream: {error}")
            }
            Self::SpawnWorker(error) => {
                write!(formatter, "failed to spawn microphone worker: {error}")
            }
            Self::StartStream(error) => {
                write!(formatter, "failed to start microphone stream: {error}")
            }
            Self::WorkerPanicked => formatter.write_str("microphone worker panicked"),
            Self::Worker(error) => write!(formatter, "microphone worker failed: {error}"),
        }
    }
}

impl std::error::Error for MicrophoneCaptureError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::QueryConfig(error) | Self::BuildStream(error) | Self::StartStream(error) => {
                Some(error)
            }
            Self::SpawnWorker(error) => Some(error),
            Self::Worker(error) => Some(error),
            Self::NoInputDevice
            | Self::NoSupportedInputConfig
            | Self::UnsupportedSampleFormat(_)
            | Self::InvalidSampleRate(_)
            | Self::InvalidChannelCount(_)
            | Self::CreateResampler(_)
            | Self::WorkerPanicked => None,
        }
    }
}

impl MicrophoneCaptureError {
    pub fn to_helper_error(&self) -> HelperError {
        let (code, message) = match self {
            Self::NoInputDevice => (
                HelperErrorCode::NoInputDevice,
                "No microphone is available. Connect one, then start a new recording.",
            ),
            Self::QueryConfig(error) | Self::BuildStream(error) | Self::StartStream(error)
                if looks_like_permission_denied(error) =>
            {
                (
                    HelperErrorCode::PermissionDenied,
                    "Microphone access is denied. Allow it in system settings, then start a new recording.",
                )
            }
            Self::QueryConfig(_) | Self::BuildStream(_) | Self::StartStream(_) => (
                HelperErrorCode::DeviceBusy,
                "The microphone could not be opened. Close other audio apps, then try again.",
            ),
            _ => (
                HelperErrorCode::InternalError,
                "The microphone uses an unsupported audio configuration.",
            ),
        };
        HelperError {
            code,
            message: message.to_owned(),
            recoverable: true,
            source: Some(AudioSource::Mic),
        }
    }
}

fn looks_like_permission_denied(error: &cpal::Error) -> bool {
    let message = error.to_string().to_ascii_lowercase();
    message.contains("permission")
        || message.contains("access denied")
        || message.contains("not permitted")
}

#[derive(Debug)]
pub enum CaptureWorkerError {
    RuntimeStreamFailure,
    Resample(String),
    AudioProcessing(String),
    VoiceActivity(String),
    SendAudio(AudioFrameSendError),
}

impl fmt::Display for CaptureWorkerError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::RuntimeStreamFailure => {
                formatter.write_str("microphone stream reported a runtime failure")
            }
            Self::Resample(error) => write!(formatter, "microphone resampling failed: {error}"),
            Self::AudioProcessing(error) => {
                write!(formatter, "microphone audio processing failed: {error}")
            }
            Self::VoiceActivity(error) => {
                write!(
                    formatter,
                    "microphone voice activity detection failed: {error}"
                )
            }
            Self::SendAudio(error) => write!(formatter, "microphone audio submit failed: {error}"),
        }
    }
}

impl std::error::Error for CaptureWorkerError {
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
