use std::fmt;
use std::io::{self, Read, Write};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{self, Receiver, Sender};
use std::thread;
use std::time::Instant;

use crate::control_codec::{ControlCodecError, read_host_message, write_helper_message};
use crate::dsp_control::DspControl;
use crate::protocol::{
    AudioDevice, ControlEnvelope, DeviceInventory, Health, HealthState, HelperControlMessage,
    HelperError, HelperErrorCode, HostControlMessage, MicrophoneMuteState, SystemAudioMuteState,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ControlLoopExit {
    ShutdownRequested,
    ControlClosed,
}

#[derive(Clone)]
pub struct ControlEventSender {
    sender: Sender<ControlWriterCommand>,
}

pub struct ControlEventReceiver {
    sender: Sender<ControlWriterCommand>,
    receiver: Receiver<ControlWriterCommand>,
}

enum ControlWriterCommand {
    Message(HelperControlMessage),
    Finish,
}

pub fn control_event_channel() -> (ControlEventSender, ControlEventReceiver) {
    let (sender, receiver) = mpsc::channel();
    (
        ControlEventSender {
            sender: sender.clone(),
        },
        ControlEventReceiver { sender, receiver },
    )
}

impl ControlEventSender {
    pub fn report(&self, error: HelperError) {
        let _ = self
            .sender
            .send(ControlWriterCommand::Message(HelperControlMessage::Error(
                error,
            )));
    }
}

pub fn run_control_loop<S, D, M, Y>(
    control: &mut S,
    started_at: Instant,
    dropped_audio_frames: &AtomicU64,
    dsp_control: &DspControl,
    mut list_devices: D,
    mut set_microphone_muted: M,
    mut set_system_audio_muted: Y,
) -> Result<ControlLoopExit, ControlLoopError>
where
    S: Read + Write,
    D: FnMut() -> Vec<AudioDevice>,
    M: FnMut(bool),
    Y: FnMut(bool),
{
    run_control_reader(
        control,
        started_at,
        dropped_audio_frames,
        dsp_control,
        &mut list_devices,
        &mut set_microphone_muted,
        &mut set_system_audio_muted,
        |control, message| send_response(control, message),
    )
}

#[allow(clippy::too_many_arguments)]
pub fn run_control_loop_with_events<R, W, D, M, Y>(
    control_reader: &mut R,
    control_writer: W,
    events: ControlEventReceiver,
    started_at: Instant,
    dropped_audio_frames: &AtomicU64,
    dsp_control: &DspControl,
    mut list_devices: D,
    mut set_microphone_muted: M,
    mut set_system_audio_muted: Y,
) -> Result<ControlLoopExit, ControlLoopError>
where
    R: Read,
    W: Write + Send + 'static,
    D: FnMut() -> Vec<AudioDevice>,
    M: FnMut(bool),
    Y: FnMut(bool),
{
    let response_sender = events.sender.clone();
    let writer = thread::Builder::new()
        .name("orion-control-writer".to_owned())
        .spawn(move || run_control_writer(control_writer, events.receiver))
        .map_err(ControlLoopError::SpawnWriter)?;

    let result = run_control_reader(
        control_reader,
        started_at,
        dropped_audio_frames,
        dsp_control,
        &mut list_devices,
        &mut set_microphone_muted,
        &mut set_system_audio_muted,
        |_control, message| {
            response_sender
                .send(ControlWriterCommand::Message(message))
                .map_err(|_| ControlLoopError::WriterUnavailable)
        },
    );
    let _ = response_sender.send(ControlWriterCommand::Finish);
    let writer_result = writer
        .join()
        .map_err(|_| ControlLoopError::WriterPanicked)?;
    let exit = result?;
    writer_result?;
    Ok(exit)
}

#[allow(clippy::too_many_arguments)]
fn run_control_reader<R, D, M, Y, O>(
    control: &mut R,
    started_at: Instant,
    dropped_audio_frames: &AtomicU64,
    dsp_control: &DspControl,
    list_devices: &mut D,
    set_microphone_muted: &mut M,
    set_system_audio_muted: &mut Y,
    mut output: O,
) -> Result<ControlLoopExit, ControlLoopError>
where
    R: Read,
    D: FnMut() -> Vec<AudioDevice>,
    M: FnMut(bool),
    Y: FnMut(bool),
    O: FnMut(&mut R, HelperControlMessage) -> Result<(), ControlLoopError>,
{
    loop {
        let Some(envelope) = read_host_message(control)? else {
            return Ok(ControlLoopExit::ControlClosed);
        };

        let response = match envelope.message {
            HostControlMessage::HealthCheck(request) => {
                Some(HelperControlMessage::Health(Health {
                    request_id: request.request_id,
                    state: HealthState::Ready,
                    uptime_ms: u64::try_from(started_at.elapsed().as_millis()).unwrap_or(u64::MAX),
                    dropped_audio_frames: dropped_audio_frames.load(Ordering::Relaxed),
                }))
            }
            HostControlMessage::ListDevices(request) => {
                Some(HelperControlMessage::DeviceInventory(DeviceInventory {
                    request_id: request.request_id,
                    devices: list_devices(),
                }))
            }
            HostControlMessage::GetDspState(request) => Some(HelperControlMessage::DspState(
                Box::new(dsp_control.state(request.request_id)),
            )),
            HostControlMessage::SetDspConfiguration(request) => {
                dsp_control.set_configuration(request.configuration);
                Some(HelperControlMessage::DspState(Box::new(
                    dsp_control.state(request.request_id),
                )))
            }
            HostControlMessage::SetMicrophoneMuted(request) => {
                set_microphone_muted(request.muted);
                Some(HelperControlMessage::MicrophoneMuteState(
                    MicrophoneMuteState {
                        request_id: request.request_id,
                        muted: request.muted,
                    },
                ))
            }
            HostControlMessage::SetSystemAudioMuted(request) => {
                set_system_audio_muted(request.muted);
                Some(HelperControlMessage::SystemAudioMuteState(
                    SystemAudioMuteState {
                        request_id: request.request_id,
                        muted: request.muted,
                    },
                ))
            }
            HostControlMessage::Shutdown => {
                return Ok(ControlLoopExit::ShutdownRequested);
            }
            HostControlMessage::HelloAck(_) => {
                output(
                    control,
                    HelperControlMessage::Error(HelperError {
                        code: HelperErrorCode::IpcProtocolError,
                        message: "hello_ack is only valid during startup handshake".to_owned(),
                        recoverable: false,
                        source: None,
                    }),
                )?;
                return Err(ControlLoopError::DuplicateHelloAck);
            }
        };

        if let Some(response) = response {
            output(control, response)?;
        }
    }
}

fn run_control_writer<W: Write>(
    mut writer: W,
    commands: Receiver<ControlWriterCommand>,
) -> Result<(), ControlLoopError> {
    while let Ok(command) = commands.recv() {
        match command {
            ControlWriterCommand::Message(message) => send_response(&mut writer, message)?,
            ControlWriterCommand::Finish => return Ok(()),
        }
    }
    Ok(())
}

fn send_response<S: Write>(
    control: &mut S,
    message: HelperControlMessage,
) -> Result<(), ControlLoopError> {
    write_helper_message(control, &ControlEnvelope::current(message))?;
    control.flush().map_err(ControlLoopError::Flush)
}

#[derive(Debug)]
pub enum ControlLoopError {
    Codec(ControlCodecError),
    Flush(io::Error),
    SpawnWriter(io::Error),
    WriterUnavailable,
    WriterPanicked,
    DuplicateHelloAck,
}

impl fmt::Display for ControlLoopError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Codec(error) => write!(formatter, "runtime control message failed: {error}"),
            Self::Flush(error) => write!(formatter, "failed to flush control response: {error}"),
            Self::SpawnWriter(error) => {
                write!(formatter, "failed to spawn control writer: {error}")
            }
            Self::WriterUnavailable => formatter.write_str("control writer is unavailable"),
            Self::WriterPanicked => formatter.write_str("control writer panicked"),
            Self::DuplicateHelloAck => {
                formatter.write_str("received duplicate hello_ack after startup handshake")
            }
        }
    }
}

impl std::error::Error for ControlLoopError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Codec(error) => Some(error),
            Self::Flush(error) => Some(error),
            Self::SpawnWriter(error) => Some(error),
            Self::WriterUnavailable | Self::WriterPanicked | Self::DuplicateHelloAck => None,
        }
    }
}

impl From<ControlCodecError> for ControlLoopError {
    fn from(error: ControlCodecError) -> Self {
        Self::Codec(error)
    }
}
