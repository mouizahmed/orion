use std::fmt;
use std::io::{Read, Write};

use crate::framing::{AUDIO_FRAME_LIMITS, FrameError, read_frame, write_frame};
use crate::protocol::AudioSource;

pub const AUDIO_PROTOCOL_VERSION: u8 = 1;
pub const AUDIO_SAMPLE_RATE_HZ: u32 = 48_000;
pub const AUDIO_CHANNELS: u16 = 1;
pub const AUDIO_HEADER_BYTES: usize = 40;
pub const MAX_PCM_SAMPLES_PER_FRAME: usize =
    (AUDIO_FRAME_LIMITS.max_payload_bytes() as usize - AUDIO_HEADER_BYTES) / size_of::<i16>();

const AUDIO_MAGIC: [u8; 4] = *b"ORA1";
const PCM_S16_LE_FORMAT: u16 = 1;
const KNOWN_FLAG_BITS: u8 = AudioFrameFlags::MUTED.bits | AudioFrameFlags::DISCONTINUITY.bits;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum VoiceActivity {
    Unknown = 0,
    Silence = 1,
    Speech = 2,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct AudioFrameFlags {
    bits: u8,
}

impl AudioFrameFlags {
    pub const MUTED: Self = Self { bits: 1 << 0 };
    pub const DISCONTINUITY: Self = Self { bits: 1 << 1 };

    pub const fn empty() -> Self {
        Self { bits: 0 }
    }

    pub const fn bits(self) -> u8 {
        self.bits
    }

    pub const fn contains(self, flag: Self) -> bool {
        self.bits & flag.bits == flag.bits
    }

    pub const fn union(self, flag: Self) -> Self {
        Self {
            bits: self.bits | flag.bits,
        }
    }

    fn from_bits(bits: u8) -> Result<Self, AudioCodecError> {
        if bits & !KNOWN_FLAG_BITS != 0 {
            return Err(AudioCodecError::UnknownFlags(bits));
        }
        Ok(Self { bits })
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct AudioFrame {
    pub source: AudioSource,
    pub sequence: u64,
    pub timestamp_us: u64,
    pub voice_activity: VoiceActivity,
    pub rms: f32,
    pub flags: AudioFrameFlags,
    pub samples: Vec<i16>,
}

pub fn write_audio_frame<W: Write>(
    writer: &mut W,
    frame: &AudioFrame,
) -> Result<(), AudioCodecError> {
    let payload = encode_audio_frame(frame)?;
    write_frame(writer, &payload, AUDIO_FRAME_LIMITS).map_err(AudioCodecError::Frame)
}

pub fn read_audio_frame<R: Read>(reader: &mut R) -> Result<Option<AudioFrame>, AudioCodecError> {
    let Some(payload) = read_frame(reader, AUDIO_FRAME_LIMITS)? else {
        return Ok(None);
    };
    decode_audio_frame(&payload).map(Some)
}

pub fn encode_audio_frame(frame: &AudioFrame) -> Result<Vec<u8>, AudioCodecError> {
    validate_rms(frame.rms)?;
    if frame.samples.is_empty() {
        return Err(AudioCodecError::EmptyPcmPayload);
    }
    if frame.samples.len() > MAX_PCM_SAMPLES_PER_FRAME {
        return Err(AudioCodecError::TooManySamples {
            samples: frame.samples.len(),
            maximum: MAX_PCM_SAMPLES_PER_FRAME,
        });
    }
    let frame_count =
        u32::try_from(frame.samples.len()).map_err(|_| AudioCodecError::TooManySamples {
            samples: frame.samples.len(),
            maximum: MAX_PCM_SAMPLES_PER_FRAME,
        })?;
    let payload_bytes = AUDIO_HEADER_BYTES + frame.samples.len() * size_of::<i16>();
    let mut payload = Vec::with_capacity(payload_bytes);

    payload.extend_from_slice(&AUDIO_MAGIC);
    payload.push(AUDIO_PROTOCOL_VERSION);
    payload.push(encode_source(frame.source));
    payload.push(frame.voice_activity as u8);
    payload.push(frame.flags.bits());
    payload.extend_from_slice(&frame.sequence.to_le_bytes());
    payload.extend_from_slice(&frame.timestamp_us.to_le_bytes());
    payload.extend_from_slice(&AUDIO_SAMPLE_RATE_HZ.to_le_bytes());
    payload.extend_from_slice(&AUDIO_CHANNELS.to_le_bytes());
    payload.extend_from_slice(&PCM_S16_LE_FORMAT.to_le_bytes());
    payload.extend_from_slice(&frame_count.to_le_bytes());
    payload.extend_from_slice(&frame.rms.to_le_bytes());
    for sample in &frame.samples {
        payload.extend_from_slice(&sample.to_le_bytes());
    }

    debug_assert_eq!(payload.len(), payload_bytes);
    Ok(payload)
}

pub fn decode_audio_frame(payload: &[u8]) -> Result<AudioFrame, AudioCodecError> {
    if payload.len() < AUDIO_HEADER_BYTES {
        return Err(AudioCodecError::HeaderTooShort {
            bytes: payload.len(),
            minimum: AUDIO_HEADER_BYTES,
        });
    }
    if payload[0..4] != AUDIO_MAGIC {
        return Err(AudioCodecError::InvalidMagic);
    }
    if payload[4] != AUDIO_PROTOCOL_VERSION {
        return Err(AudioCodecError::UnsupportedVersion(payload[4]));
    }

    let source = decode_source(payload[5])?;
    let voice_activity = decode_voice_activity(payload[6])?;
    let flags = AudioFrameFlags::from_bits(payload[7])?;
    let sequence = read_u64(payload, 8);
    let timestamp_us = read_u64(payload, 16);
    let sample_rate_hz = read_u32(payload, 24);
    if sample_rate_hz != AUDIO_SAMPLE_RATE_HZ {
        return Err(AudioCodecError::UnsupportedSampleRate(sample_rate_hz));
    }
    let channels = read_u16(payload, 28);
    if channels != AUDIO_CHANNELS {
        return Err(AudioCodecError::UnsupportedChannelCount(channels));
    }
    let sample_format = read_u16(payload, 30);
    if sample_format != PCM_S16_LE_FORMAT {
        return Err(AudioCodecError::UnsupportedSampleFormat(sample_format));
    }
    let frame_count = read_u32(payload, 32);
    if frame_count == 0 {
        return Err(AudioCodecError::EmptyPcmPayload);
    }
    let rms = f32::from_le_bytes(read_array(payload, 36));
    validate_rms(rms)?;

    let sample_count = usize::try_from(frame_count)
        .ok()
        .and_then(|frames| frames.checked_mul(usize::from(channels)))
        .ok_or(AudioCodecError::PayloadLengthOverflow)?;
    let expected_payload_bytes = sample_count
        .checked_mul(size_of::<i16>())
        .and_then(|bytes| bytes.checked_add(AUDIO_HEADER_BYTES))
        .ok_or(AudioCodecError::PayloadLengthOverflow)?;
    if payload.len() != expected_payload_bytes {
        return Err(AudioCodecError::PayloadLengthMismatch {
            bytes: payload.len(),
            expected: expected_payload_bytes,
        });
    }

    let samples = payload[AUDIO_HEADER_BYTES..]
        .as_chunks::<{ size_of::<i16>() }>()
        .0
        .iter()
        .map(|bytes| i16::from_le_bytes(*bytes))
        .collect();
    Ok(AudioFrame {
        source,
        sequence,
        timestamp_us,
        voice_activity,
        rms,
        flags,
        samples,
    })
}

fn encode_source(source: AudioSource) -> u8 {
    match source {
        AudioSource::Mic => 1,
        AudioSource::System => 2,
    }
}

fn decode_source(value: u8) -> Result<AudioSource, AudioCodecError> {
    match value {
        1 => Ok(AudioSource::Mic),
        2 => Ok(AudioSource::System),
        value => Err(AudioCodecError::InvalidSource(value)),
    }
}

fn decode_voice_activity(value: u8) -> Result<VoiceActivity, AudioCodecError> {
    match value {
        0 => Ok(VoiceActivity::Unknown),
        1 => Ok(VoiceActivity::Silence),
        2 => Ok(VoiceActivity::Speech),
        value => Err(AudioCodecError::InvalidVoiceActivity(value)),
    }
}

fn validate_rms(rms: f32) -> Result<(), AudioCodecError> {
    if !rms.is_finite() || !(0.0..=1.0).contains(&rms) {
        return Err(AudioCodecError::InvalidRms(rms));
    }
    Ok(())
}

fn read_u16(payload: &[u8], offset: usize) -> u16 {
    u16::from_le_bytes(read_array(payload, offset))
}

fn read_u32(payload: &[u8], offset: usize) -> u32 {
    u32::from_le_bytes(read_array(payload, offset))
}

fn read_u64(payload: &[u8], offset: usize) -> u64 {
    u64::from_le_bytes(read_array(payload, offset))
}

fn read_array<const LENGTH: usize>(payload: &[u8], offset: usize) -> [u8; LENGTH] {
    payload[offset..offset + LENGTH]
        .try_into()
        .expect("fixed audio header offsets are validated by the minimum header length")
}

#[derive(Debug)]
pub enum AudioCodecError {
    Frame(FrameError),
    HeaderTooShort { bytes: usize, minimum: usize },
    InvalidMagic,
    UnsupportedVersion(u8),
    InvalidSource(u8),
    InvalidVoiceActivity(u8),
    UnknownFlags(u8),
    UnsupportedSampleRate(u32),
    UnsupportedChannelCount(u16),
    UnsupportedSampleFormat(u16),
    InvalidRms(f32),
    EmptyPcmPayload,
    TooManySamples { samples: usize, maximum: usize },
    PayloadLengthOverflow,
    PayloadLengthMismatch { bytes: usize, expected: usize },
}

impl fmt::Display for AudioCodecError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Frame(error) => write!(formatter, "audio framing failed: {error}"),
            Self::HeaderTooShort { bytes, minimum } => write!(
                formatter,
                "audio payload has {bytes} bytes; header requires at least {minimum} bytes",
            ),
            Self::InvalidMagic => formatter.write_str("invalid audio frame magic"),
            Self::UnsupportedVersion(version) => {
                write!(formatter, "unsupported audio protocol version {version}")
            }
            Self::InvalidSource(source) => write!(formatter, "invalid audio source {source}"),
            Self::InvalidVoiceActivity(state) => {
                write!(formatter, "invalid voice activity state {state}")
            }
            Self::UnknownFlags(flags) => {
                write!(formatter, "unknown audio frame flags {flags:#04x}")
            }
            Self::UnsupportedSampleRate(sample_rate) => {
                write!(formatter, "unsupported audio sample rate {sample_rate} Hz")
            }
            Self::UnsupportedChannelCount(channels) => {
                write!(formatter, "unsupported audio channel count {channels}")
            }
            Self::UnsupportedSampleFormat(format) => {
                write!(formatter, "unsupported audio sample format {format}")
            }
            Self::InvalidRms(rms) => write!(formatter, "invalid normalized RMS level {rms}"),
            Self::EmptyPcmPayload => formatter.write_str("audio frame PCM payload is empty"),
            Self::TooManySamples { samples, maximum } => write!(
                formatter,
                "audio frame has {samples} PCM samples; maximum is {maximum}",
            ),
            Self::PayloadLengthOverflow => {
                formatter.write_str("audio frame payload length overflowed")
            }
            Self::PayloadLengthMismatch { bytes, expected } => write!(
                formatter,
                "audio payload has {bytes} bytes; header declares {expected} bytes",
            ),
        }
    }
}

impl std::error::Error for AudioCodecError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Frame(error) => Some(error),
            Self::HeaderTooShort { .. }
            | Self::InvalidMagic
            | Self::UnsupportedVersion(_)
            | Self::InvalidSource(_)
            | Self::InvalidVoiceActivity(_)
            | Self::UnknownFlags(_)
            | Self::UnsupportedSampleRate(_)
            | Self::UnsupportedChannelCount(_)
            | Self::UnsupportedSampleFormat(_)
            | Self::InvalidRms(_)
            | Self::EmptyPcmPayload
            | Self::TooManySamples { .. }
            | Self::PayloadLengthOverflow
            | Self::PayloadLengthMismatch { .. } => None,
        }
    }
}

impl From<FrameError> for AudioCodecError {
    fn from(error: FrameError) -> Self {
        Self::Frame(error)
    }
}
