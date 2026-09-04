use std::collections::VecDeque;
use std::fmt;

use webrtc_vad::{SampleRate, Vad, VadMode};

use crate::audio_codec::{AudioFrame, AudioFrameFlags, VoiceActivity};

const TEN_MS_FRAMES: usize = 480;
const TWENTY_MS_FRAMES: usize = 960;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VadAggressiveness {
    Quality,
    LowBitrate,
    Aggressive,
    VeryAggressive,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct VoiceActivityConfig {
    pub enabled: bool,
    pub aggressiveness: VadAggressiveness,
    pub pre_roll_frames: usize,
    pub post_roll_frames: usize,
}

impl Default for VoiceActivityConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            aggressiveness: VadAggressiveness::Aggressive,
            pre_roll_frames: 2,
            post_roll_frames: 5,
        }
    }
}

struct PendingFrame {
    frame: AudioFrame,
}

/// Adds per-source WebRTC VAD metadata while preserving every PCM frame.
/// A bounded output delay lets an onset label recent pre-roll as speech.
pub struct VoiceActivityAnnotator {
    detector: Option<Vad>,
    config: VoiceActivityConfig,
    pending: VecDeque<PendingFrame>,
    post_roll_remaining: usize,
}

impl VoiceActivityAnnotator {
    pub fn new(config: VoiceActivityConfig) -> Self {
        let detector = config.enabled.then(|| {
            Vad::new_with_rate_and_mode(
                SampleRate::Rate48kHz,
                match config.aggressiveness {
                    VadAggressiveness::Quality => VadMode::Quality,
                    VadAggressiveness::LowBitrate => VadMode::LowBitrate,
                    VadAggressiveness::Aggressive => VadMode::Aggressive,
                    VadAggressiveness::VeryAggressive => VadMode::VeryAggressive,
                },
            )
        });
        Self {
            detector,
            config,
            pending: VecDeque::with_capacity(config.pre_roll_frames.saturating_add(1)),
            post_roll_remaining: 0,
        }
    }

    pub fn push(
        &mut self,
        mut frame: AudioFrame,
    ) -> Result<Option<AudioFrame>, VoiceActivityError> {
        if self.detector.is_none() {
            frame.voice_activity = VoiceActivity::Unknown;
            return Ok(Some(frame));
        }

        let muted = frame.flags.contains(AudioFrameFlags::MUTED);
        let raw_speech = if muted {
            false
        } else {
            self.classify(&frame.samples)?
        };
        frame.voice_activity = if !muted && (raw_speech || self.post_roll_remaining > 0) {
            VoiceActivity::Speech
        } else {
            VoiceActivity::Silence
        };
        if muted {
            self.post_roll_remaining = 0;
        } else if raw_speech {
            self.post_roll_remaining = self.config.post_roll_frames;
            for pending in &mut self.pending {
                if !pending.frame.flags.contains(AudioFrameFlags::MUTED) {
                    pending.frame.voice_activity = VoiceActivity::Speech;
                }
            }
        } else {
            self.post_roll_remaining = self.post_roll_remaining.saturating_sub(1);
        }
        self.pending.push_back(PendingFrame { frame });
        if self.pending.len() > self.config.pre_roll_frames {
            return Ok(self.pending.pop_front().map(|pending| pending.frame));
        }
        Ok(None)
    }

    pub fn finish(&mut self) -> Vec<AudioFrame> {
        self.pending
            .drain(..)
            .map(|pending| pending.frame)
            .collect()
    }

    pub fn reset(&mut self) -> Vec<AudioFrame> {
        let pending = self.finish();
        if let Some(detector) = self.detector.as_mut() {
            detector.reset();
            detector.set_sample_rate(SampleRate::Rate48kHz);
            detector.set_mode(match self.config.aggressiveness {
                VadAggressiveness::Quality => VadMode::Quality,
                VadAggressiveness::LowBitrate => VadMode::LowBitrate,
                VadAggressiveness::Aggressive => VadMode::Aggressive,
                VadAggressiveness::VeryAggressive => VadMode::VeryAggressive,
            });
        }
        self.post_roll_remaining = 0;
        pending
    }

    pub fn reconfigure(&mut self, config: VoiceActivityConfig) -> Vec<AudioFrame> {
        if self.config == config {
            return Vec::new();
        }
        let pending = self.finish();
        *self = Self::new(config);
        pending
    }

    fn classify(&mut self, samples: &[i16]) -> Result<bool, VoiceActivityError> {
        let detector = self
            .detector
            .as_mut()
            .expect("classification requires an enabled detector");
        let mut offset = 0;
        let mut speech = false;
        while samples.len().saturating_sub(offset) >= TWENTY_MS_FRAMES {
            speech |= detector
                .is_voice_segment(&samples[offset..offset + TWENTY_MS_FRAMES])
                .map_err(|()| VoiceActivityError::InvalidFrameLength(TWENTY_MS_FRAMES))?;
            offset += TWENTY_MS_FRAMES;
        }
        if samples.len().saturating_sub(offset) >= TEN_MS_FRAMES {
            speech |= detector
                .is_voice_segment(&samples[offset..offset + TEN_MS_FRAMES])
                .map_err(|()| VoiceActivityError::InvalidFrameLength(TEN_MS_FRAMES))?;
        }
        Ok(speech)
    }
}

#[derive(Debug)]
pub enum VoiceActivityError {
    InvalidFrameLength(usize),
}

impl fmt::Display for VoiceActivityError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidFrameLength(frames) => {
                write!(formatter, "WebRTC VAD rejected a {frames}-frame block")
            }
        }
    }
}

impl std::error::Error for VoiceActivityError {}
