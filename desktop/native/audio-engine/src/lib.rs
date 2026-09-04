#![forbid(unsafe_code)]

pub mod audio_codec;
pub mod audio_frame_mux;
pub mod control_codec;
pub mod control_loop;
pub mod device_inventory;
pub mod dsp_control;
pub mod framing;
pub mod handshake;
pub mod launch;
#[cfg(any(windows, target_os = "macos"))]
pub mod microphone_capture;
#[cfg(any(windows, target_os = "macos"))]
pub mod parent_watchdog;
pub mod protocol;
#[cfg(any(windows, target_os = "macos"))]
pub mod source_audio_processing;
#[cfg(any(windows, target_os = "macos"))]
pub mod streaming_resampler;
#[cfg(any(windows, target_os = "macos"))]
pub mod voice_activity;

#[cfg(target_os = "macos")]
pub mod macos_system_capture;
#[cfg(target_os = "macos")]
pub mod macos_transport;

#[cfg(windows)]
pub mod windows_system_capture;
#[cfg(windows)]
pub mod windows_transport;
