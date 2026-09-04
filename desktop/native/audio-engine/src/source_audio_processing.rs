use std::fmt;
use std::sync::mpsc::{Receiver, SyncSender, TryRecvError, TrySendError, sync_channel};

use sonora::config::{
    AdaptiveDigital, EchoCanceller, GainController2, NoiseSuppression, NoiseSuppressionLevel,
};
use sonora::{AudioProcessing, Config, StreamConfig};

use crate::audio_codec::{AUDIO_CHANNELS, AUDIO_SAMPLE_RATE_HZ, AudioFrame, AudioFrameFlags};
use crate::protocol::{AudioSource, DspSourceTelemetry};

const TEN_MS_FRAMES: usize = 480;
const TEN_MS_MICROSECONDS: u64 = 10_000;
const ECHO_REFERENCE_CAPACITY: usize = 64;
const MAX_REFERENCE_LEAD_US: u64 = 20_000;
const MAX_REFERENCE_AGE_US: u64 = 500_000;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SourceAudioProcessingConfig {
    pub automatic_gain_control: bool,
    pub noise_suppression: bool,
    pub echo_cancellation: bool,
    pub maximum_gain_db: f32,
}

impl SourceAudioProcessingConfig {
    pub fn for_source(source: AudioSource) -> Self {
        match source {
            AudioSource::Mic => Self {
                automatic_gain_control: true,
                noise_suppression: true,
                echo_cancellation: true,
                maximum_gain_db: 20.0,
            },
            AudioSource::System => Self {
                automatic_gain_control: true,
                noise_suppression: false,
                echo_cancellation: false,
                maximum_gain_db: 12.0,
            },
        }
    }
}

#[derive(Debug)]
struct EchoReferenceBlock {
    timestamp_us: u64,
    discontinuity: bool,
    samples: [i16; TEN_MS_FRAMES],
}

pub struct EchoReferenceSender {
    sender: SyncSender<EchoReferenceBlock>,
    discontinuity_pending: bool,
}

impl EchoReferenceSender {
    pub fn submit(&mut self, frame: &AudioFrame) -> Result<(), EchoReferenceError> {
        if frame.source != AudioSource::System {
            return Err(EchoReferenceError::SourceMismatch(frame.source));
        }
        self.discontinuity_pending |= frame.flags.contains(AudioFrameFlags::DISCONTINUITY);
        for (index, samples) in frame
            .samples
            .as_chunks::<TEN_MS_FRAMES>()
            .0
            .iter()
            .enumerate()
        {
            let timestamp_us = frame.timestamp_us.saturating_add(
                u64::try_from(index)
                    .unwrap_or(u64::MAX)
                    .saturating_mul(TEN_MS_MICROSECONDS),
            );
            let reference = EchoReferenceBlock {
                timestamp_us,
                discontinuity: self.discontinuity_pending,
                samples: *samples,
            };
            match self.sender.try_send(reference) {
                Ok(()) => self.discontinuity_pending = false,
                Err(TrySendError::Full(_)) => {
                    self.discontinuity_pending = true;
                    break;
                }
                Err(TrySendError::Disconnected(_)) => break,
            }
        }
        Ok(())
    }
}

pub struct EchoReferenceReceiver {
    receiver: Receiver<EchoReferenceBlock>,
    pending: Option<EchoReferenceBlock>,
}

impl EchoReferenceReceiver {
    fn pop_ready(&mut self, capture_timestamp_us: u64) -> Option<EchoReferenceBlock> {
        let reference = match self.pending.take() {
            Some(reference) => reference,
            None => match self.receiver.try_recv() {
                Ok(reference) => reference,
                Err(TryRecvError::Empty | TryRecvError::Disconnected) => return None,
            },
        };
        if reference.timestamp_us > capture_timestamp_us.saturating_add(MAX_REFERENCE_LEAD_US) {
            self.pending = Some(reference);
            return None;
        }
        Some(reference)
    }

    fn clear(&mut self) {
        self.pending = None;
        while self.receiver.try_recv().is_ok() {}
    }
}

pub fn echo_reference_channel() -> (EchoReferenceSender, EchoReferenceReceiver) {
    let (sender, receiver) = sync_channel(ECHO_REFERENCE_CAPACITY);
    (
        EchoReferenceSender {
            sender,
            discontinuity_pending: false,
        },
        EchoReferenceReceiver {
            receiver,
            pending: None,
        },
    )
}

/// Owns source-local WebRTC Audio Processing state. Input and output remain
/// 48 kHz mono PCM16; microphone AEC consumes a bounded system render reference.
pub struct SourceAudioProcessor {
    source: AudioSource,
    config: SourceAudioProcessingConfig,
    processor: AudioProcessing,
    scratch: [i16; TEN_MS_FRAMES],
    echo_reference: Option<EchoReferenceReceiver>,
    echo_active: bool,
    latest_reference_timestamp_us: Option<u64>,
    has_processed_audio: bool,
    effective_gain_db: Option<f64>,
}

impl SourceAudioProcessor {
    pub fn new(source: AudioSource, config: SourceAudioProcessingConfig) -> Self {
        Self {
            source,
            config,
            processor: build_processor(config),
            scratch: [0; TEN_MS_FRAMES],
            echo_reference: None,
            echo_active: false,
            latest_reference_timestamp_us: None,
            has_processed_audio: false,
            effective_gain_db: None,
        }
    }

    pub fn new_microphone(
        config: SourceAudioProcessingConfig,
        echo_reference: EchoReferenceReceiver,
    ) -> Self {
        let mut initial_config = config;
        initial_config.echo_cancellation = false;
        Self {
            source: AudioSource::Mic,
            config,
            processor: build_processor(initial_config),
            scratch: [0; TEN_MS_FRAMES],
            echo_reference: Some(echo_reference),
            echo_active: false,
            latest_reference_timestamp_us: None,
            has_processed_audio: false,
            effective_gain_db: None,
        }
    }

    pub fn process(&mut self, frame: &mut AudioFrame) -> Result<(), SourceAudioProcessingError> {
        if frame.source != self.source {
            return Err(SourceAudioProcessingError::SourceMismatch {
                expected: self.source,
                actual: frame.source,
            });
        }
        if frame.flags.contains(AudioFrameFlags::MUTED) {
            frame.samples.fill(0);
            self.has_processed_audio = true;
            self.effective_gain_db = None;
            return Ok(());
        }

        let input_rms = signal_rms(&frame.samples);

        for (index, block) in frame
            .samples
            .as_chunks_mut::<TEN_MS_FRAMES>()
            .0
            .iter_mut()
            .enumerate()
        {
            let timestamp_us = frame.timestamp_us.saturating_add(
                u64::try_from(index)
                    .unwrap_or(u64::MAX)
                    .saturating_mul(TEN_MS_MICROSECONDS),
            );
            self.prepare_echo_reference(timestamp_us)?;
            self.processor
                .process_capture_i16(block.as_slice(), &mut self.scratch)
                .map_err(SourceAudioProcessingError::Processor)?;
            block.copy_from_slice(&self.scratch);
        }
        self.has_processed_audio = true;
        self.effective_gain_db = effective_gain_db(input_rms, signal_rms(&frame.samples));
        Ok(())
    }

    pub fn reset(&mut self) {
        if let Some(reference) = self.echo_reference.as_mut() {
            reference.clear();
        }
        self.echo_active = false;
        self.latest_reference_timestamp_us = None;
        self.effective_gain_db = None;
        let mut config = self.config;
        config.echo_cancellation = false;
        self.processor = build_processor(config);
        self.scratch.fill(0);
    }

    pub fn reconfigure(&mut self, config: SourceAudioProcessingConfig) {
        if self.config == config {
            return;
        }
        self.config = config;
        self.echo_active = false;
        self.latest_reference_timestamp_us = None;
        self.effective_gain_db = None;
        if let Some(reference) = self.echo_reference.as_mut() {
            reference.clear();
        }
        let mut active_config = config;
        if self.echo_reference.is_some() {
            active_config.echo_cancellation = false;
        }
        self.processor = build_processor(active_config);
        self.scratch.fill(0);
    }

    pub fn telemetry(&self, voice_activity_detection_active: bool) -> DspSourceTelemetry {
        let statistics = self.processor.statistics();
        DspSourceTelemetry {
            has_processed_audio: self.has_processed_audio,
            voice_activity_detection_active,
            automatic_gain_control_active: self.config.automatic_gain_control,
            noise_suppression_active: self.config.noise_suppression,
            echo_cancellation_active: self.echo_active,
            effective_gain_db: finite(self.effective_gain_db),
            echo_return_loss_db: finite(statistics.echo_return_loss),
            echo_return_loss_enhancement_db: finite(statistics.echo_return_loss_enhancement),
            divergent_filter_fraction: finite_unit(statistics.divergent_filter_fraction),
            residual_echo_likelihood: finite_unit(statistics.residual_echo_likelihood),
            delay_ms: statistics.delay_ms,
        }
    }

    fn prepare_echo_reference(
        &mut self,
        capture_timestamp_us: u64,
    ) -> Result<(), SourceAudioProcessingError> {
        if !self.config.echo_cancellation || self.echo_reference.is_none() {
            if let Some(reference) = self.echo_reference.as_mut() {
                reference.clear();
            }
            return Ok(());
        }

        while let Some(reference) = self
            .echo_reference
            .as_mut()
            .and_then(|receiver| receiver.pop_ready(capture_timestamp_us))
        {
            if reference.discontinuity
                || reference.timestamp_us.saturating_add(MAX_REFERENCE_AGE_US)
                    < capture_timestamp_us
            {
                self.deactivate_echo();
                if reference.timestamp_us.saturating_add(MAX_REFERENCE_AGE_US)
                    < capture_timestamp_us
                {
                    continue;
                }
            }
            if !self.echo_active {
                self.activate_echo();
            }
            self.processor
                .process_render_i16(&reference.samples, &mut self.scratch)
                .map_err(SourceAudioProcessingError::Processor)?;
            self.latest_reference_timestamp_us = Some(reference.timestamp_us);
        }

        if let Some(reference_timestamp_us) = self.latest_reference_timestamp_us {
            if reference_timestamp_us.saturating_add(MAX_REFERENCE_AGE_US) < capture_timestamp_us {
                self.deactivate_echo();
            } else if self.echo_active {
                let delay_ms = capture_timestamp_us
                    .saturating_sub(reference_timestamp_us)
                    .saturating_div(1_000)
                    .min(500) as i32;
                self.processor
                    .set_stream_delay_ms(delay_ms)
                    .map_err(SourceAudioProcessingError::Processor)?;
            }
        }
        Ok(())
    }

    fn activate_echo(&mut self) {
        self.processor = build_processor(self.config);
        self.echo_active = true;
        self.latest_reference_timestamp_us = None;
    }

    fn deactivate_echo(&mut self) {
        let mut config = self.config;
        config.echo_cancellation = false;
        self.processor = build_processor(config);
        self.echo_active = false;
        self.latest_reference_timestamp_us = None;
    }
}

fn signal_rms(samples: &[i16]) -> f64 {
    if samples.is_empty() {
        return 0.0;
    }
    let sum_squares = samples.iter().fold(0.0, |sum, &sample| {
        let sample = f64::from(sample);
        sum + sample * sample
    });
    (sum_squares / samples.len() as f64).sqrt()
}

fn effective_gain_db(input_rms: f64, output_rms: f64) -> Option<f64> {
    if input_rms < 1.0 {
        return None;
    }
    let gain = 20.0 * (output_rms.max(1.0) / input_rms).log10();
    gain.is_finite().then(|| gain.clamp(-90.0, 90.0))
}

fn finite(value: Option<f64>) -> Option<f64> {
    value.filter(|value| value.is_finite())
}

fn finite_unit(value: Option<f64>) -> Option<f64> {
    finite(value).filter(|value| (0.0..=1.0).contains(value))
}

fn build_processor(config: SourceAudioProcessingConfig) -> AudioProcessing {
    let stream = StreamConfig::new(AUDIO_SAMPLE_RATE_HZ, AUDIO_CHANNELS);
    let adaptive_digital = AdaptiveDigital {
        headroom_db: 5.0,
        max_gain_db: config.maximum_gain_db,
        initial_gain_db: 0.0,
        max_gain_change_db_per_second: 3.0,
        max_output_noise_level_dbfs: -50.0,
    };
    let processing = Config {
        echo_canceller: config.echo_cancellation.then(EchoCanceller::default),
        noise_suppression: config.noise_suppression.then(|| NoiseSuppression {
            level: NoiseSuppressionLevel::Moderate,
            ..NoiseSuppression::default()
        }),
        gain_controller2: config.automatic_gain_control.then(|| GainController2 {
            adaptive_digital: Some(adaptive_digital),
            ..GainController2::default()
        }),
        ..Config::default()
    };
    AudioProcessing::builder()
        .config(processing)
        .capture_config(stream)
        .render_config(stream)
        .echo_detector(config.echo_cancellation)
        .build()
}

#[derive(Debug)]
pub enum SourceAudioProcessingError {
    SourceMismatch {
        expected: AudioSource,
        actual: AudioSource,
    },
    Processor(sonora::Error),
}

#[derive(Debug)]
pub enum EchoReferenceError {
    SourceMismatch(AudioSource),
}

impl fmt::Display for EchoReferenceError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::SourceMismatch(source) => {
                write!(
                    formatter,
                    "echo reference requires system audio, received {source:?}"
                )
            }
        }
    }
}

impl std::error::Error for EchoReferenceError {}

impl fmt::Display for SourceAudioProcessingError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::SourceMismatch { expected, actual } => {
                write!(
                    formatter,
                    "audio processor expected {expected:?}, received {actual:?}"
                )
            }
            Self::Processor(error) => write!(formatter, "WebRTC audio processing failed: {error}"),
        }
    }
}

impl std::error::Error for SourceAudioProcessingError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Processor(error) => Some(error),
            Self::SourceMismatch { .. } => None,
        }
    }
}
