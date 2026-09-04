#![forbid(unsafe_code)]

use std::error::Error;
use std::io;
#[cfg(any(windows, target_os = "macos"))]
use std::io::Write;
#[cfg(any(windows, target_os = "macos"))]
use std::sync::Arc;
#[cfg(any(windows, target_os = "macos"))]
use std::sync::atomic::AtomicU64;
#[cfg(any(windows, target_os = "macos"))]
use std::time::Instant;

fn main() {
    if let Err(error) = run() {
        eprintln!("audio engine error: {error}");
        std::process::exit(2);
    }
}

#[cfg(windows)]
fn run() -> Result<(), Box<dyn Error>> {
    use interprocess::TryClone;
    use orion_audio_engine::audio_frame_mux::AudioFrameMux;
    use orion_audio_engine::control_loop::{control_event_channel, run_control_loop_with_events};
    use orion_audio_engine::device_inventory::list_audio_devices;
    use orion_audio_engine::dsp_control::DspControl;
    use orion_audio_engine::handshake::perform_helper_handshake;
    use orion_audio_engine::launch::{LaunchConfig, READY_LINE};
    use orion_audio_engine::microphone_capture::MicrophoneCapture;
    use orion_audio_engine::parent_watchdog::ParentWatchdog;
    use orion_audio_engine::protocol::{AudioSource, Platform};
    use orion_audio_engine::source_audio_processing::echo_reference_channel;
    use orion_audio_engine::windows_system_capture::WindowsSystemCapture;
    use orion_audio_engine::windows_transport::WindowsPipeListeners;

    let started_at = Instant::now();
    let config = LaunchConfig::parse_env()?;
    let _parent_watchdog = ParentWatchdog::start(config.parent_pid)?;
    let listeners = WindowsPipeListeners::bind(&config)?;

    {
        let mut stdout = io::stdout().lock();
        writeln!(stdout, "{READY_LINE}")?;
        stdout.flush()?;
    }

    let mut control = listeners.accept_control()?;
    let audio = listeners.accept_audio()?;
    perform_helper_handshake(&mut control, Platform::Windows, env!("CARGO_PKG_VERSION"))?;
    let control_writer = control.try_clone()?;
    let (control_events, control_event_receiver) = control_event_channel();
    let dropped_audio_frames = Arc::new(AtomicU64::new(0));
    let audio_mux = AudioFrameMux::start(audio, Arc::clone(&dropped_audio_frames))?;
    let (echo_reference_sender, echo_reference_receiver) = echo_reference_channel();
    let dsp_control = DspControl::default();
    let system_audio = match WindowsSystemCapture::start(
        audio_mux.source_sender(AudioSource::System)?,
        echo_reference_sender,
        dsp_control.clone(),
        started_at,
        Arc::clone(&dropped_audio_frames),
        control_events.clone(),
    ) {
        Ok(capture) => Some(capture),
        Err(error) => {
            control_events.report(error.to_helper_error());
            None
        }
    };
    let microphone = match MicrophoneCapture::start(
        audio_mux.source_sender(AudioSource::Mic)?,
        echo_reference_receiver,
        dsp_control.clone(),
        started_at,
        Arc::clone(&dropped_audio_frames),
        control_events.clone(),
    ) {
        Ok(capture) => Some(capture),
        Err(error) => {
            control_events.report(error.to_helper_error());
            None
        }
    };
    let control_result = run_control_loop_with_events(
        &mut control,
        control_writer,
        control_event_receiver,
        started_at,
        &dropped_audio_frames,
        &dsp_control,
        list_audio_devices,
        |muted| {
            if let Some(capture) = microphone.as_ref() {
                capture.set_muted(muted);
            }
        },
        |muted| {
            if let Some(capture) = system_audio.as_ref() {
                capture.set_muted(muted);
            }
        },
    );
    let system_capture_result = system_audio.map(WindowsSystemCapture::stop).transpose();
    let capture_result = microphone.map(MicrophoneCapture::stop).transpose();
    let mux_result = audio_mux.stop();
    control_result?;
    capture_result?;
    system_capture_result?;
    mux_result?;

    Ok(())
}

#[cfg(target_os = "macos")]
fn run() -> Result<(), Box<dyn Error>> {
    use orion_audio_engine::audio_frame_mux::AudioFrameMux;
    use orion_audio_engine::control_loop::{control_event_channel, run_control_loop_with_events};
    use orion_audio_engine::device_inventory::list_audio_devices;
    use orion_audio_engine::dsp_control::DspControl;
    use orion_audio_engine::handshake::perform_helper_handshake;
    use orion_audio_engine::launch::{LaunchConfig, READY_LINE};
    use orion_audio_engine::macos_system_capture::MacOsSystemCapture;
    use orion_audio_engine::macos_transport::MacOsSocketListeners;
    use orion_audio_engine::microphone_capture::MicrophoneCapture;
    use orion_audio_engine::parent_watchdog::ParentWatchdog;
    use orion_audio_engine::protocol::{AudioSource, Platform};
    use orion_audio_engine::source_audio_processing::echo_reference_channel;

    let started_at = Instant::now();
    let config = LaunchConfig::parse_env()?;
    let _parent_watchdog = ParentWatchdog::start(config.parent_pid)?;
    let listeners = MacOsSocketListeners::bind(&config)?;

    {
        let mut stdout = io::stdout().lock();
        writeln!(stdout, "{READY_LINE}")?;
        stdout.flush()?;
    }

    let mut control = listeners.accept_control()?;
    let audio = listeners.accept_audio()?;
    perform_helper_handshake(&mut control, Platform::Macos, env!("CARGO_PKG_VERSION"))?;
    let control_writer = control.try_clone()?;
    let (control_events, control_event_receiver) = control_event_channel();
    let dropped_audio_frames = Arc::new(AtomicU64::new(0));
    let audio_mux = AudioFrameMux::start(audio, Arc::clone(&dropped_audio_frames))?;
    let (echo_reference_sender, echo_reference_receiver) = echo_reference_channel();
    let dsp_control = DspControl::default();
    let system_audio = match MacOsSystemCapture::start(
        audio_mux.source_sender(AudioSource::System)?,
        echo_reference_sender,
        dsp_control.clone(),
        started_at,
        Arc::clone(&dropped_audio_frames),
        control_events.clone(),
    ) {
        Ok(capture) => Some(capture),
        Err(error) => {
            control_events.report(error.to_helper_error());
            None
        }
    };
    let microphone = match MicrophoneCapture::start(
        audio_mux.source_sender(AudioSource::Mic)?,
        echo_reference_receiver,
        dsp_control.clone(),
        started_at,
        Arc::clone(&dropped_audio_frames),
        control_events.clone(),
    ) {
        Ok(capture) => Some(capture),
        Err(error) => {
            control_events.report(error.to_helper_error());
            None
        }
    };
    let control_result = run_control_loop_with_events(
        &mut control,
        control_writer,
        control_event_receiver,
        started_at,
        &dropped_audio_frames,
        &dsp_control,
        list_audio_devices,
        |muted| {
            if let Some(capture) = microphone.as_ref() {
                capture.set_muted(muted);
            }
        },
        |muted| {
            if let Some(capture) = system_audio.as_ref() {
                capture.set_muted(muted);
            }
        },
    );
    let system_capture_result = system_audio.map(MacOsSystemCapture::stop).transpose();
    let capture_result = microphone.map(MicrophoneCapture::stop).transpose();
    let mux_result = audio_mux.stop();
    control_result?;
    capture_result?;
    system_capture_result?;
    mux_result?;

    Ok(())
}

#[cfg(not(any(windows, target_os = "macos")))]
fn run() -> Result<(), Box<dyn Error>> {
    Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "audio engine transport is not implemented for this platform",
    )
    .into())
}
