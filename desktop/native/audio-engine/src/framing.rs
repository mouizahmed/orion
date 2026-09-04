use std::fmt;
use std::io::{self, Read, Write};

pub const LENGTH_PREFIX_BYTES: usize = size_of::<u32>();
pub const CONTROL_FRAME_LIMITS: FrameLimits = FrameLimits::new(256 * 1024);
pub const AUDIO_FRAME_LIMITS: FrameLimits = FrameLimits::new(1024 * 1024);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FrameLimits {
    max_payload_bytes: u32,
}

impl FrameLimits {
    pub const fn new(max_payload_bytes: u32) -> Self {
        Self { max_payload_bytes }
    }

    pub const fn max_payload_bytes(self) -> u32 {
        self.max_payload_bytes
    }
}

#[derive(Debug)]
pub enum FrameError {
    Io(io::Error),
    PayloadTooLarge {
        payload_bytes: u32,
        max_payload_bytes: u32,
    },
    PayloadLengthOverflow,
}

impl fmt::Display for FrameError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io(error) => write!(formatter, "frame I/O failed: {error}"),
            Self::PayloadTooLarge {
                payload_bytes,
                max_payload_bytes,
            } => write!(
                formatter,
                "frame payload is {payload_bytes} bytes; maximum is {max_payload_bytes} bytes"
            ),
            Self::PayloadLengthOverflow => {
                formatter.write_str("frame payload length cannot be represented")
            }
        }
    }
}

impl std::error::Error for FrameError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Io(error) => Some(error),
            Self::PayloadTooLarge { .. } | Self::PayloadLengthOverflow => None,
        }
    }
}

impl From<io::Error> for FrameError {
    fn from(error: io::Error) -> Self {
        Self::Io(error)
    }
}

pub fn read_frame<R: Read>(
    reader: &mut R,
    limits: FrameLimits,
) -> Result<Option<Vec<u8>>, FrameError> {
    let Some(prefix) = read_length_prefix(reader)? else {
        return Ok(None);
    };

    let payload_bytes = u32::from_le_bytes(prefix);
    if payload_bytes > limits.max_payload_bytes {
        return Err(FrameError::PayloadTooLarge {
            payload_bytes,
            max_payload_bytes: limits.max_payload_bytes,
        });
    }

    let payload_len =
        usize::try_from(payload_bytes).map_err(|_| FrameError::PayloadLengthOverflow)?;
    let mut payload = vec![0; payload_len];
    reader.read_exact(&mut payload)?;
    Ok(Some(payload))
}

pub fn write_frame<W: Write>(
    writer: &mut W,
    payload: &[u8],
    limits: FrameLimits,
) -> Result<(), FrameError> {
    let payload_bytes =
        u32::try_from(payload.len()).map_err(|_| FrameError::PayloadLengthOverflow)?;
    if payload_bytes > limits.max_payload_bytes {
        return Err(FrameError::PayloadTooLarge {
            payload_bytes,
            max_payload_bytes: limits.max_payload_bytes,
        });
    }

    writer.write_all(&payload_bytes.to_le_bytes())?;
    writer.write_all(payload)?;
    Ok(())
}

fn read_length_prefix<R: Read>(
    reader: &mut R,
) -> Result<Option<[u8; LENGTH_PREFIX_BYTES]>, FrameError> {
    let mut prefix = [0; LENGTH_PREFIX_BYTES];
    let mut filled = 0;

    while filled < prefix.len() {
        match reader.read(&mut prefix[filled..]) {
            Ok(0) if filled == 0 => return Ok(None),
            Ok(0) => {
                return Err(io::Error::new(
                    io::ErrorKind::UnexpectedEof,
                    "stream ended within a frame length prefix",
                )
                .into());
            }
            Ok(read) => filled += read,
            Err(error) if error.kind() == io::ErrorKind::Interrupted => {}
            Err(error) => return Err(error.into()),
        }
    }

    Ok(Some(prefix))
}
