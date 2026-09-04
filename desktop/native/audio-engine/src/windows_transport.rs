use std::ffi::OsStr;
use std::fmt;
use std::io;
use std::path::{Path, PathBuf};

use interprocess::os::windows::named_pipe::{
    DuplexPipeStream, PipeListener, PipeListenerOptions, SendPipeStream, pipe_mode,
};
use interprocess::os::windows::security_descriptor::SecurityDescriptor;
use widestring::u16cstr;

use crate::launch::LaunchConfig;

const PIPE_PREFIX: &str = r"\\.\pipe\orion-audio-";
const PIPE_BUFFER_SIZE: u32 = 64 * 1024;
const OWNER_ONLY_DACL: &widestring::U16CStr = u16cstr!("D:P(A;;GA;;;OW)");

pub type ControlPipeStream = DuplexPipeStream<pipe_mode::Bytes>;
pub type AudioPipeStream = SendPipeStream<pipe_mode::Bytes>;

type ControlPipeListener = PipeListener<pipe_mode::Bytes, pipe_mode::Bytes>;
type AudioPipeListener = PipeListener<pipe_mode::None, pipe_mode::Bytes>;

#[derive(Debug)]
pub struct WindowsPipeListeners {
    control: ControlPipeListener,
    audio: AudioPipeListener,
}

impl WindowsPipeListeners {
    pub fn bind(config: &LaunchConfig) -> Result<Self, WindowsTransportError> {
        validate_endpoint(
            &config.control_endpoint,
            &config.instance_id,
            PipeChannel::Control,
        )?;
        validate_endpoint(
            &config.audio_endpoint,
            &config.instance_id,
            PipeChannel::Audio,
        )?;

        let control = listener_options(&config.control_endpoint)?
            .create_duplex::<pipe_mode::Bytes>()
            .map_err(|source| WindowsTransportError::Bind {
                channel: PipeChannel::Control,
                endpoint: config.control_endpoint.clone(),
                source,
            })?;
        let audio = listener_options(&config.audio_endpoint)?
            .create_send_only::<pipe_mode::Bytes>()
            .map_err(|source| WindowsTransportError::Bind {
                channel: PipeChannel::Audio,
                endpoint: config.audio_endpoint.clone(),
                source,
            })?;

        Ok(Self { control, audio })
    }

    pub fn accept_control(&self) -> io::Result<ControlPipeStream> {
        self.control.accept()
    }

    pub fn accept_audio(&self) -> io::Result<AudioPipeStream> {
        self.audio.accept()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PipeChannel {
    Control,
    Audio,
}

impl PipeChannel {
    const fn suffix(self) -> &'static str {
        match self {
            Self::Control => "control",
            Self::Audio => "audio",
        }
    }
}

impl fmt::Display for PipeChannel {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.suffix())
    }
}

#[derive(Debug)]
pub enum WindowsTransportError {
    InvalidEndpoint {
        channel: PipeChannel,
        endpoint: PathBuf,
    },
    SecurityDescriptor(io::Error),
    Bind {
        channel: PipeChannel,
        endpoint: PathBuf,
        source: io::Error,
    },
}

impl fmt::Display for WindowsTransportError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidEndpoint { channel, endpoint } => write!(
                formatter,
                "invalid {channel} named-pipe endpoint: {}",
                endpoint.display()
            ),
            Self::SecurityDescriptor(error) => {
                write!(
                    formatter,
                    "failed to create owner-only pipe security: {error}"
                )
            }
            Self::Bind {
                channel,
                endpoint,
                source,
            } => write!(
                formatter,
                "failed to bind {channel} named pipe {}: {source}",
                endpoint.display()
            ),
        }
    }
}

impl std::error::Error for WindowsTransportError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::SecurityDescriptor(error) => Some(error),
            Self::Bind { source, .. } => Some(source),
            Self::InvalidEndpoint { .. } => None,
        }
    }
}

fn listener_options(endpoint: &Path) -> Result<PipeListenerOptions<'_>, WindowsTransportError> {
    let security_descriptor = SecurityDescriptor::deserialize(OWNER_ONLY_DACL)
        .map_err(WindowsTransportError::SecurityDescriptor)?;

    Ok(PipeListenerOptions::new()
        .path(endpoint)
        .accept_remote(false)
        .input_buffer_size_hint(PIPE_BUFFER_SIZE)
        .output_buffer_size_hint(PIPE_BUFFER_SIZE)
        .security_descriptor(Some(security_descriptor))
        .inheritable(false))
}

fn validate_endpoint(
    endpoint: &Path,
    instance_id: &str,
    channel: PipeChannel,
) -> Result<(), WindowsTransportError> {
    let expected = format!("{PIPE_PREFIX}{instance_id}-{}", channel.suffix());
    if endpoint.as_os_str() != OsStr::new(&expected) {
        return Err(WindowsTransportError::InvalidEndpoint {
            channel,
            endpoint: endpoint.to_path_buf(),
        });
    }
    Ok(())
}
