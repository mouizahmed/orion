use std::fmt;
use std::num::NonZeroU32;
use std::process;
use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use sysinfo::{Pid, System, get_current_pid};

const WATCHDOG_INTERVAL: Duration = Duration::from_millis(500);
const PARENT_LOST_EXIT_CODE: i32 = 3;

#[derive(Debug)]
pub struct ParentWatchdog {
    stop: Option<Sender<()>>,
    thread: Option<JoinHandle<()>>,
}

impl ParentWatchdog {
    pub fn start(parent_pid: NonZeroU32) -> Result<Self, ParentWatchdogError> {
        let expected_parent = Pid::from_u32(parent_pid.get());
        let mut system = System::new();
        let expected_parent_start = verify_parent(&mut system, expected_parent)?;

        let (stop, stop_receiver) = mpsc::channel();
        let thread = thread::Builder::new()
            .name("orion-parent-watchdog".to_owned())
            .spawn(move || {
                loop {
                    let parent_is_same_process = system.refresh_process(expected_parent)
                        && system
                            .process(expected_parent)
                            .is_some_and(|parent| parent.start_time() == expected_parent_start);
                    if !parent_is_same_process {
                        process::exit(PARENT_LOST_EXIT_CODE);
                    }
                    match stop_receiver.recv_timeout(WATCHDOG_INTERVAL) {
                        Ok(()) | Err(RecvTimeoutError::Disconnected) => return,
                        Err(RecvTimeoutError::Timeout) => {}
                    }
                }
            })
            .map_err(ParentWatchdogError::Spawn)?;

        Ok(Self {
            stop: Some(stop),
            thread: Some(thread),
        })
    }
}

impl Drop for ParentWatchdog {
    fn drop(&mut self) {
        if let Some(stop) = self.stop.take() {
            let _ = stop.send(());
        }
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

#[derive(Debug)]
pub enum ParentWatchdogError {
    CurrentPid(&'static str),
    CurrentProcessUnavailable,
    ParentMismatch { expected: u32, actual: Option<u32> },
    ParentNotRunning(u32),
    Spawn(std::io::Error),
}

impl fmt::Display for ParentWatchdogError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::CurrentPid(error) => write!(formatter, "failed to read helper PID: {error}"),
            Self::CurrentProcessUnavailable => {
                formatter.write_str("helper process metadata is unavailable")
            }
            Self::ParentMismatch { expected, actual } => match actual {
                Some(actual) => write!(
                    formatter,
                    "configured parent PID {expected} does not match actual parent PID {actual}",
                ),
                None => write!(
                    formatter,
                    "configured parent PID {expected} cannot be verified because the helper has no parent metadata",
                ),
            },
            Self::ParentNotRunning(pid) => {
                write!(formatter, "configured parent PID {pid} is not running")
            }
            Self::Spawn(error) => write!(formatter, "failed to start parent watchdog: {error}"),
        }
    }
}

impl std::error::Error for ParentWatchdogError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Spawn(error) => Some(error),
            Self::CurrentPid(_)
            | Self::CurrentProcessUnavailable
            | Self::ParentMismatch { .. }
            | Self::ParentNotRunning(_) => None,
        }
    }
}

fn verify_parent(system: &mut System, expected_parent: Pid) -> Result<u64, ParentWatchdogError> {
    let current_pid = get_current_pid().map_err(ParentWatchdogError::CurrentPid)?;
    if !system.refresh_process(current_pid) {
        return Err(ParentWatchdogError::CurrentProcessUnavailable);
    }
    let actual_parent = system
        .process(current_pid)
        .ok_or(ParentWatchdogError::CurrentProcessUnavailable)?
        .parent();
    if actual_parent != Some(expected_parent) {
        return Err(ParentWatchdogError::ParentMismatch {
            expected: expected_parent.as_u32(),
            actual: actual_parent.map(Pid::as_u32),
        });
    }
    if !system.refresh_process(expected_parent) {
        return Err(ParentWatchdogError::ParentNotRunning(
            expected_parent.as_u32(),
        ));
    }
    system
        .process(expected_parent)
        .map(|parent| parent.start_time())
        .ok_or(ParentWatchdogError::ParentNotRunning(
            expected_parent.as_u32(),
        ))
}
