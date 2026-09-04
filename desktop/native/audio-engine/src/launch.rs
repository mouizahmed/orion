use std::ffi::{OsStr, OsString};
use std::fmt;
use std::num::NonZeroU32;
use std::path::PathBuf;

pub const READY_LINE: &str = "ready";

const INSTANCE_ID_ARGUMENT: &str = "--instance-id";
const PARENT_PID_ARGUMENT: &str = "--parent-pid";
const CONTROL_ENDPOINT_ARGUMENT: &str = "--control-endpoint";
const AUDIO_ENDPOINT_ARGUMENT: &str = "--audio-endpoint";
const MAX_INSTANCE_ID_LENGTH: usize = 64;
const ENDPOINT_INSTANCE_TOKEN_LENGTH: usize = 23;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LaunchConfig {
    pub instance_id: String,
    pub parent_pid: NonZeroU32,
    pub control_endpoint: PathBuf,
    pub audio_endpoint: PathBuf,
}

impl LaunchConfig {
    pub fn parse_env() -> Result<Self, LaunchConfigError> {
        Self::parse(std::env::args_os().skip(1))
    }

    pub fn parse<I>(args: I) -> Result<Self, LaunchConfigError>
    where
        I: IntoIterator<Item = OsString>,
    {
        let mut args = args.into_iter();
        let mut instance_id = None;
        let mut parent_pid = None;
        let mut control_endpoint = None;
        let mut audio_endpoint = None;

        while let Some(argument) = args.next() {
            match argument.to_str() {
                Some(INSTANCE_ID_ARGUMENT) => set_once(
                    &mut instance_id,
                    next_value(&mut args, INSTANCE_ID_ARGUMENT)?,
                    INSTANCE_ID_ARGUMENT,
                )?,
                Some(PARENT_PID_ARGUMENT) => set_once(
                    &mut parent_pid,
                    next_value(&mut args, PARENT_PID_ARGUMENT)?,
                    PARENT_PID_ARGUMENT,
                )?,
                Some(CONTROL_ENDPOINT_ARGUMENT) => {
                    let value = next_value(&mut args, CONTROL_ENDPOINT_ARGUMENT)?;
                    set_once(&mut control_endpoint, value, CONTROL_ENDPOINT_ARGUMENT)?
                }
                Some(AUDIO_ENDPOINT_ARGUMENT) => {
                    let value = next_value(&mut args, AUDIO_ENDPOINT_ARGUMENT)?;
                    set_once(&mut audio_endpoint, value, AUDIO_ENDPOINT_ARGUMENT)?
                }
                _ => return Err(LaunchConfigError::UnknownArgument(argument)),
            }
        }

        let instance_id = required(instance_id, INSTANCE_ID_ARGUMENT)?
            .into_string()
            .map_err(LaunchConfigError::InvalidInstanceId)?;
        validate_instance_id(&instance_id)?;

        let parent_pid = required(parent_pid, PARENT_PID_ARGUMENT)?
            .into_string()
            .map_err(LaunchConfigError::InvalidParentPid)?
            .parse::<NonZeroU32>()
            .map_err(LaunchConfigError::InvalidParentPidNumber)?;
        let control_endpoint =
            PathBuf::from(required(control_endpoint, CONTROL_ENDPOINT_ARGUMENT)?);
        let audio_endpoint = PathBuf::from(required(audio_endpoint, AUDIO_ENDPOINT_ARGUMENT)?);

        validate_endpoint(
            control_endpoint.as_os_str(),
            &instance_id,
            CONTROL_ENDPOINT_ARGUMENT,
        )?;
        validate_endpoint(
            audio_endpoint.as_os_str(),
            &instance_id,
            AUDIO_ENDPOINT_ARGUMENT,
        )?;
        if control_endpoint == audio_endpoint {
            return Err(LaunchConfigError::DuplicateEndpoints);
        }

        Ok(Self {
            instance_id,
            parent_pid,
            control_endpoint,
            audio_endpoint,
        })
    }
}

#[derive(Debug)]
pub enum LaunchConfigError {
    UnknownArgument(OsString),
    MissingValue(&'static str),
    DuplicateArgument(&'static str),
    MissingArgument(&'static str),
    InvalidInstanceId(OsString),
    InvalidParentPid(OsString),
    InvalidParentPidNumber(std::num::ParseIntError),
    EmptyEndpoint(&'static str),
    EndpointMissingInstanceId(&'static str),
    DuplicateEndpoints,
}

impl fmt::Display for LaunchConfigError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::UnknownArgument(argument) => {
                write!(
                    formatter,
                    "unknown argument: {}",
                    argument.to_string_lossy()
                )
            }
            Self::MissingValue(argument) => write!(formatter, "missing value for {argument}"),
            Self::DuplicateArgument(argument) => write!(formatter, "duplicate {argument}"),
            Self::MissingArgument(argument) => write!(formatter, "missing required {argument}"),
            Self::InvalidInstanceId(_) => write!(formatter, "invalid {INSTANCE_ID_ARGUMENT}"),
            Self::InvalidParentPid(value) => write!(
                formatter,
                "invalid {PARENT_PID_ARGUMENT}: {}",
                value.to_string_lossy()
            ),
            Self::InvalidParentPidNumber(error) => {
                write!(formatter, "invalid {PARENT_PID_ARGUMENT}: {error}")
            }
            Self::EmptyEndpoint(argument) => write!(formatter, "empty {argument}"),
            Self::EndpointMissingInstanceId(argument) => {
                write!(formatter, "{argument} must include the helper instance id")
            }
            Self::DuplicateEndpoints => {
                formatter.write_str("control and audio endpoints must be distinct")
            }
        }
    }
}

impl std::error::Error for LaunchConfigError {}

fn next_value<I>(args: &mut I, argument: &'static str) -> Result<OsString, LaunchConfigError>
where
    I: Iterator<Item = OsString>,
{
    args.next().ok_or(LaunchConfigError::MissingValue(argument))
}

fn set_once(
    destination: &mut Option<OsString>,
    value: OsString,
    argument: &'static str,
) -> Result<(), LaunchConfigError> {
    if destination.replace(value).is_some() {
        return Err(LaunchConfigError::DuplicateArgument(argument));
    }
    Ok(())
}

fn required(
    value: Option<OsString>,
    argument: &'static str,
) -> Result<OsString, LaunchConfigError> {
    value.ok_or(LaunchConfigError::MissingArgument(argument))
}

fn validate_instance_id(instance_id: &str) -> Result<(), LaunchConfigError> {
    if instance_id.is_empty()
        || instance_id.len() > MAX_INSTANCE_ID_LENGTH
        || !instance_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
    {
        return Err(LaunchConfigError::InvalidInstanceId(OsString::from(
            instance_id,
        )));
    }
    Ok(())
}

fn validate_endpoint(
    endpoint: &OsStr,
    instance_id: &str,
    argument: &'static str,
) -> Result<(), LaunchConfigError> {
    if endpoint.is_empty() {
        return Err(LaunchConfigError::EmptyEndpoint(argument));
    }
    let token_length = instance_id.len().min(ENDPOINT_INSTANCE_TOKEN_LENGTH);
    if !endpoint
        .to_string_lossy()
        .contains(&instance_id[..token_length])
    {
        return Err(LaunchConfigError::EndpointMissingInstanceId(argument));
    }
    Ok(())
}
