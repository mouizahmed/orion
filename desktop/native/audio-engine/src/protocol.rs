use serde::{Deserialize, Serialize};

pub const CONTROL_PROTOCOL_VERSION: u16 = 1;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ControlEnvelope<T> {
    pub protocol_version: u16,
    #[serde(flatten)]
    pub message: T,
}

impl<T> ControlEnvelope<T> {
    pub const fn current(message: T) -> Self {
        Self {
            protocol_version: CONTROL_PROTOCOL_VERSION,
            message,
        }
    }

    pub const fn has_supported_version(&self) -> bool {
        self.protocol_version == CONTROL_PROTOCOL_VERSION
    }
}

pub type HostControlEnvelope = ControlEnvelope<HostControlMessage>;
pub type HelperControlEnvelope = ControlEnvelope<HelperControlMessage>;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", content = "payload", rename_all = "snake_case")]
pub enum HostControlMessage {
    HelloAck(HelloAck),
    HealthCheck(Request),
    ListDevices(Request),
    GetDspState(Request),
    SetDspConfiguration(SetDspConfiguration),
    SetMicrophoneMuted(SetMicrophoneMuted),
    SetSystemAudioMuted(SetSystemAudioMuted),
    Shutdown,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", content = "payload", rename_all = "snake_case")]
pub enum HelperControlMessage {
    Hello(Hello),
    Health(Health),
    DeviceInventory(DeviceInventory),
    DspState(Box<DspState>),
    MicrophoneMuteState(MicrophoneMuteState),
    SystemAudioMuteState(SystemAudioMuteState),
    Error(HelperError),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Hello {
    pub helper_version: String,
    pub platform: Platform,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HelloAck {
    pub accepted_protocol_version: u16,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Request {
    pub request_id: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct DspConfiguration {
    pub voice_activity_detection: bool,
    pub automatic_gain_control: bool,
    pub noise_suppression: bool,
    pub echo_cancellation: bool,
}

impl Default for DspConfiguration {
    fn default() -> Self {
        Self {
            voice_activity_detection: true,
            automatic_gain_control: true,
            noise_suppression: true,
            echo_cancellation: true,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SetDspConfiguration {
    pub request_id: String,
    pub configuration: DspConfiguration,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DspState {
    pub request_id: String,
    pub configuration: DspConfiguration,
    pub microphone: DspSourceTelemetry,
    pub system: DspSourceTelemetry,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize, Deserialize)]
pub struct DspSourceTelemetry {
    pub has_processed_audio: bool,
    pub voice_activity_detection_active: bool,
    pub automatic_gain_control_active: bool,
    pub noise_suppression_active: bool,
    pub echo_cancellation_active: bool,
    pub effective_gain_db: Option<f64>,
    pub echo_return_loss_db: Option<f64>,
    pub echo_return_loss_enhancement_db: Option<f64>,
    pub divergent_filter_fraction: Option<f64>,
    pub residual_echo_likelihood: Option<f64>,
    pub delay_ms: Option<i32>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SetMicrophoneMuted {
    pub request_id: String,
    pub muted: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MicrophoneMuteState {
    pub request_id: String,
    pub muted: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SetSystemAudioMuted {
    pub request_id: String,
    pub muted: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SystemAudioMuteState {
    pub request_id: String,
    pub muted: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Health {
    pub request_id: String,
    pub state: HealthState,
    pub uptime_ms: u64,
    pub dropped_audio_frames: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DeviceInventory {
    pub request_id: String,
    pub devices: Vec<AudioDevice>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AudioDevice {
    pub id: String,
    pub name: String,
    pub kind: AudioDeviceKind,
    pub is_default: bool,
    pub is_available: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HelperError {
    pub code: HelperErrorCode,
    pub message: String,
    pub recoverable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<AudioSource>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Platform {
    Windows,
    Macos,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HealthState {
    Starting,
    Ready,
    ShuttingDown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AudioDeviceKind {
    Microphone,
    SystemOutput,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AudioSource {
    Mic,
    System,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HelperErrorCode {
    PermissionDenied,
    NoInputDevice,
    NoOutputDevice,
    SystemAudioUnavailable,
    DeviceDisconnected,
    DeviceBusy,
    AudioOverrun,
    IpcProtocolError,
    UnsupportedProtocolVersion,
    InternalError,
}
