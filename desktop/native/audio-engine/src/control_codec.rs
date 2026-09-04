use std::fmt;
use std::io::{Read, Write};

use crate::framing::{CONTROL_FRAME_LIMITS, FrameError, read_frame, write_frame};
use crate::protocol::{CONTROL_PROTOCOL_VERSION, HelperControlEnvelope, HostControlEnvelope};

#[derive(Debug)]
pub enum ControlCodecError {
    Frame(FrameError),
    Json(serde_json::Error),
    UnsupportedProtocolVersion { received: u16, supported: u16 },
}

impl fmt::Display for ControlCodecError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Frame(error) => write!(formatter, "control frame failed: {error}"),
            Self::Json(error) => write!(formatter, "control JSON failed: {error}"),
            Self::UnsupportedProtocolVersion {
                received,
                supported,
            } => write!(
                formatter,
                "unsupported control protocol version {received}; expected {supported}"
            ),
        }
    }
}

impl std::error::Error for ControlCodecError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Frame(error) => Some(error),
            Self::Json(error) => Some(error),
            Self::UnsupportedProtocolVersion { .. } => None,
        }
    }
}

impl From<FrameError> for ControlCodecError {
    fn from(error: FrameError) -> Self {
        Self::Frame(error)
    }
}

impl From<serde_json::Error> for ControlCodecError {
    fn from(error: serde_json::Error) -> Self {
        Self::Json(error)
    }
}

pub fn read_host_message<R: Read>(
    reader: &mut R,
) -> Result<Option<HostControlEnvelope>, ControlCodecError> {
    let Some(payload) = read_frame(reader, CONTROL_FRAME_LIMITS)? else {
        return Ok(None);
    };
    let envelope = serde_json::from_slice::<HostControlEnvelope>(&payload)?;
    require_supported_version(envelope.protocol_version)?;
    Ok(Some(envelope))
}

pub fn write_helper_message<W: Write>(
    writer: &mut W,
    envelope: &HelperControlEnvelope,
) -> Result<(), ControlCodecError> {
    require_supported_version(envelope.protocol_version)?;
    let payload = serde_json::to_vec(envelope)?;
    write_frame(writer, &payload, CONTROL_FRAME_LIMITS)?;
    Ok(())
}

fn require_supported_version(received: u16) -> Result<(), ControlCodecError> {
    if received == CONTROL_PROTOCOL_VERSION {
        return Ok(());
    }
    Err(ControlCodecError::UnsupportedProtocolVersion {
        received,
        supported: CONTROL_PROTOCOL_VERSION,
    })
}
