use std::fmt;
use std::io::{self, Read, Write};

use crate::control_codec::{ControlCodecError, read_host_message, write_helper_message};
use crate::protocol::{
    CONTROL_PROTOCOL_VERSION, ControlEnvelope, Hello, HelperControlMessage, HostControlMessage,
    Platform,
};

pub fn perform_helper_handshake<S: Read + Write>(
    control: &mut S,
    platform: Platform,
    helper_version: &str,
) -> Result<(), HandshakeError> {
    let hello = ControlEnvelope::current(HelperControlMessage::Hello(Hello {
        helper_version: helper_version.to_owned(),
        platform,
    }));
    write_helper_message(control, &hello)?;
    control.flush().map_err(HandshakeError::Flush)?;

    let acknowledgement = read_host_message(control)?.ok_or(HandshakeError::ControlClosed)?;
    let HostControlMessage::HelloAck(acknowledgement) = acknowledgement.message else {
        return Err(HandshakeError::ExpectedHelloAck {
            received: host_message_name(&acknowledgement.message),
        });
    };

    if acknowledgement.accepted_protocol_version != CONTROL_PROTOCOL_VERSION {
        return Err(HandshakeError::ProtocolVersionRejected {
            accepted: acknowledgement.accepted_protocol_version,
            supported: CONTROL_PROTOCOL_VERSION,
        });
    }

    Ok(())
}

#[derive(Debug)]
pub enum HandshakeError {
    Codec(ControlCodecError),
    Flush(io::Error),
    ControlClosed,
    ExpectedHelloAck { received: &'static str },
    ProtocolVersionRejected { accepted: u16, supported: u16 },
}

impl fmt::Display for HandshakeError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Codec(error) => write!(formatter, "handshake control message failed: {error}"),
            Self::Flush(error) => write!(formatter, "failed to flush helper hello: {error}"),
            Self::ControlClosed => formatter.write_str("control channel closed before hello_ack"),
            Self::ExpectedHelloAck { received } => {
                write!(formatter, "expected hello_ack, received {received}")
            }
            Self::ProtocolVersionRejected {
                accepted,
                supported,
            } => write!(
                formatter,
                "host acknowledged protocol version {accepted}; helper requires {supported}"
            ),
        }
    }
}

impl std::error::Error for HandshakeError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Codec(error) => Some(error),
            Self::Flush(error) => Some(error),
            Self::ControlClosed
            | Self::ExpectedHelloAck { .. }
            | Self::ProtocolVersionRejected { .. } => None,
        }
    }
}

impl From<ControlCodecError> for HandshakeError {
    fn from(error: ControlCodecError) -> Self {
        Self::Codec(error)
    }
}

const fn host_message_name(message: &HostControlMessage) -> &'static str {
    match message {
        HostControlMessage::HelloAck(_) => "hello_ack",
        HostControlMessage::HealthCheck(_) => "health_check",
        HostControlMessage::ListDevices(_) => "list_devices",
        HostControlMessage::GetDspState(_) => "get_dsp_state",
        HostControlMessage::SetDspConfiguration(_) => "set_dsp_configuration",
        HostControlMessage::SetMicrophoneMuted(_) => "set_microphone_muted",
        HostControlMessage::SetSystemAudioMuted(_) => "set_system_audio_muted",
        HostControlMessage::Shutdown => "shutdown",
    }
}
