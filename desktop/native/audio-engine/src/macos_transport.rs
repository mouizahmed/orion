use std::ffi::OsStr;
use std::fmt;
use std::fs::{self, File, OpenOptions};
use std::io;
use std::os::unix::ffi::OsStrExt;
use std::os::unix::fs::{FileTypeExt, PermissionsExt};
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::{Component, Path, PathBuf};

use fs2::FileExt;

use crate::launch::LaunchConfig;

const SOCKET_ROOT_DIRECTORY: &str = "oa";
const SOCKET_FALLBACK_ROOT_PREFIX: &str = "oa-";
const CONTROL_SOCKET_NAME: &str = "c.sock";
const AUDIO_SOCKET_NAME: &str = "a.sock";
const INSTANCE_LOCK_NAME: &str = ".instance.lock";
const ENDPOINT_INSTANCE_TOKEN_LENGTH: usize = 23;
const SOCKET_PATH_MAX_BYTES: usize = 103;
const DIRECTORY_MODE: u32 = 0o700;
const SOCKET_MODE: u32 = 0o600;

pub type ControlSocketStream = UnixStream;
pub type AudioSocketStream = UnixStream;

#[derive(Debug)]
pub struct MacOsSocketListeners {
    control: UnixListener,
    audio: UnixListener,
    control_endpoint: PathBuf,
    audio_endpoint: PathBuf,
    instance_directory: PathBuf,
    instance_lock: File,
}

impl MacOsSocketListeners {
    pub fn bind(config: &LaunchConfig) -> Result<Self, MacOsTransportError> {
        let instance_directory = validate_endpoint_layout(config)?;
        prepare_directory(&instance_directory)?;
        let instance_lock = lock_instance(&instance_directory)?;
        remove_stale_socket(&config.control_endpoint, SocketChannel::Control)?;
        remove_stale_socket(&config.audio_endpoint, SocketChannel::Audio)?;

        let control = bind_socket(&config.control_endpoint, SocketChannel::Control)?;
        let audio = match bind_socket(&config.audio_endpoint, SocketChannel::Audio) {
            Ok(listener) => listener,
            Err(error) => {
                drop(control);
                remove_bound_socket(&config.control_endpoint);
                return Err(error);
            }
        };

        Ok(Self {
            control,
            audio,
            control_endpoint: config.control_endpoint.clone(),
            audio_endpoint: config.audio_endpoint.clone(),
            instance_directory,
            instance_lock,
        })
    }

    pub fn accept_control(&self) -> io::Result<ControlSocketStream> {
        self.control.accept().map(|(stream, _address)| stream)
    }

    pub fn accept_audio(&self) -> io::Result<AudioSocketStream> {
        self.audio.accept().map(|(stream, _address)| stream)
    }
}

impl Drop for MacOsSocketListeners {
    fn drop(&mut self) {
        remove_bound_socket(&self.control_endpoint);
        remove_bound_socket(&self.audio_endpoint);
        let lock_path = self.instance_directory.join(INSTANCE_LOCK_NAME);
        let _ = FileExt::unlock(&self.instance_lock);
        let _ = fs::remove_file(lock_path);
        let _ = fs::remove_dir(&self.instance_directory);
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SocketChannel {
    Control,
    Audio,
}

impl fmt::Display for SocketChannel {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Control => formatter.write_str("control"),
            Self::Audio => formatter.write_str("audio"),
        }
    }
}

#[derive(Debug)]
pub enum MacOsTransportError {
    InvalidEndpointLayout,
    PrepareDirectory {
        path: PathBuf,
        source: io::Error,
    },
    UnsafeLockPath {
        path: PathBuf,
    },
    LockInstance {
        path: PathBuf,
        source: io::Error,
    },
    InstanceAlreadyActive {
        path: PathBuf,
    },
    UnsafeExistingPath {
        channel: SocketChannel,
        endpoint: PathBuf,
    },
    RemoveStaleSocket {
        channel: SocketChannel,
        endpoint: PathBuf,
        source: io::Error,
    },
    Bind {
        channel: SocketChannel,
        endpoint: PathBuf,
        source: io::Error,
    },
    ProtectSocket {
        channel: SocketChannel,
        endpoint: PathBuf,
        source: io::Error,
    },
}

impl fmt::Display for MacOsTransportError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidEndpointLayout => formatter.write_str(
                "macOS endpoints must be distinct c.sock and a.sock files under an approved per-instance runtime directory",
            ),
            Self::PrepareDirectory { path, source } => write!(
                formatter,
                "failed to create or protect socket directory {}: {source}",
                path.display(),
            ),
            Self::UnsafeLockPath { path } => write!(
                formatter,
                "refusing to use non-file instance lock {}",
                path.display(),
            ),
            Self::LockInstance { path, source } => write!(
                formatter,
                "failed to lock helper instance at {}: {source}",
                path.display(),
            ),
            Self::InstanceAlreadyActive { path } => write!(
                formatter,
                "another helper already owns instance lock {}",
                path.display(),
            ),
            Self::UnsafeExistingPath { channel, endpoint } => write!(
                formatter,
                "refusing to replace non-socket {channel} endpoint {}",
                endpoint.display(),
            ),
            Self::RemoveStaleSocket {
                channel,
                endpoint,
                source,
            } => write!(
                formatter,
                "failed to remove stale {channel} socket {}: {source}",
                endpoint.display(),
            ),
            Self::Bind {
                channel,
                endpoint,
                source,
            } => write!(
                formatter,
                "failed to bind {channel} Unix socket {}: {source}",
                endpoint.display(),
            ),
            Self::ProtectSocket {
                channel,
                endpoint,
                source,
            } => write!(
                formatter,
                "failed to protect {channel} Unix socket {}: {source}",
                endpoint.display(),
            ),
        }
    }
}

impl std::error::Error for MacOsTransportError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::PrepareDirectory { source, .. }
            | Self::LockInstance { source, .. }
            | Self::RemoveStaleSocket { source, .. }
            | Self::Bind { source, .. }
            | Self::ProtectSocket { source, .. } => Some(source),
            Self::InvalidEndpointLayout
            | Self::UnsafeLockPath { .. }
            | Self::InstanceAlreadyActive { .. }
            | Self::UnsafeExistingPath { .. } => None,
        }
    }
}

fn validate_endpoint_layout(config: &LaunchConfig) -> Result<PathBuf, MacOsTransportError> {
    let Some(control_directory) = config.control_endpoint.parent() else {
        return Err(MacOsTransportError::InvalidEndpointLayout);
    };
    let Some(audio_directory) = config.audio_endpoint.parent() else {
        return Err(MacOsTransportError::InvalidEndpointLayout);
    };
    let token_length = config.instance_id.len().min(ENDPOINT_INSTANCE_TOKEN_LENGTH);
    let expected_instance_directory = format!("i-{}", &config.instance_id[..token_length]);
    let valid = control_directory == audio_directory
        && is_normal_absolute_path(&config.control_endpoint)
        && is_normal_absolute_path(&config.audio_endpoint)
        && config.control_endpoint.as_os_str().as_bytes().len() <= SOCKET_PATH_MAX_BYTES
        && config.audio_endpoint.as_os_str().as_bytes().len() <= SOCKET_PATH_MAX_BYTES
        && control_directory.file_name() == Some(OsStr::new(&expected_instance_directory))
        && control_directory
            .parent()
            .and_then(Path::file_name)
            .is_some_and(is_approved_socket_root)
        && config.control_endpoint.file_name() == Some(OsStr::new(CONTROL_SOCKET_NAME))
        && config.audio_endpoint.file_name() == Some(OsStr::new(AUDIO_SOCKET_NAME));
    if !valid {
        return Err(MacOsTransportError::InvalidEndpointLayout);
    }
    Ok(control_directory.to_path_buf())
}

fn is_approved_socket_root(name: &OsStr) -> bool {
    let Some(name) = name.to_str() else {
        return false;
    };
    if name == SOCKET_ROOT_DIRECTORY {
        return true;
    }
    name.strip_prefix(SOCKET_FALLBACK_ROOT_PREFIX)
        .is_some_and(|suffix| {
            suffix.len() == 16
                && suffix
                    .bytes()
                    .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        })
}

fn is_normal_absolute_path(path: &Path) -> bool {
    path.is_absolute()
        && path
            .components()
            .all(|component| !matches!(component, Component::CurDir | Component::ParentDir))
}

fn prepare_directory(instance_directory: &Path) -> Result<(), MacOsTransportError> {
    let root_directory = instance_directory
        .parent()
        .ok_or(MacOsTransportError::InvalidEndpointLayout)?;
    create_or_validate_directory(root_directory)?;
    create_or_validate_directory(instance_directory)
}

fn create_or_validate_directory(path: &Path) -> Result<(), MacOsTransportError> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if !metadata.file_type().is_symlink() && metadata.is_dir() => {}
        Ok(_) => {
            return Err(MacOsTransportError::PrepareDirectory {
                path: path.to_path_buf(),
                source: io::Error::new(
                    io::ErrorKind::InvalidInput,
                    "existing socket directory is not a real directory",
                ),
            });
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            fs::create_dir(path).map_err(|source| MacOsTransportError::PrepareDirectory {
                path: path.to_path_buf(),
                source,
            })?;
        }
        Err(source) => {
            return Err(MacOsTransportError::PrepareDirectory {
                path: path.to_path_buf(),
                source,
            });
        }
    }

    fs::set_permissions(path, fs::Permissions::from_mode(DIRECTORY_MODE)).map_err(|source| {
        MacOsTransportError::PrepareDirectory {
            path: path.to_path_buf(),
            source,
        }
    })
}

fn lock_instance(instance_directory: &Path) -> Result<File, MacOsTransportError> {
    let lock_path = instance_directory.join(INSTANCE_LOCK_NAME);
    match fs::symlink_metadata(&lock_path) {
        Ok(metadata) if metadata.file_type().is_file() => {}
        Ok(_) => {
            return Err(MacOsTransportError::UnsafeLockPath { path: lock_path });
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(source) => {
            return Err(MacOsTransportError::LockInstance {
                path: lock_path,
                source,
            });
        }
    }

    let lock = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(&lock_path)
        .map_err(|source| MacOsTransportError::LockInstance {
            path: lock_path.clone(),
            source,
        })?;
    fs::set_permissions(&lock_path, fs::Permissions::from_mode(SOCKET_MODE)).map_err(|source| {
        MacOsTransportError::LockInstance {
            path: lock_path.clone(),
            source,
        }
    })?;
    match lock.try_lock_exclusive() {
        Ok(()) => Ok(lock),
        Err(source) if source.kind() == io::ErrorKind::WouldBlock => {
            Err(MacOsTransportError::InstanceAlreadyActive { path: lock_path })
        }
        Err(source) => Err(MacOsTransportError::LockInstance {
            path: lock_path,
            source,
        }),
    }
}

fn remove_stale_socket(endpoint: &Path, channel: SocketChannel) -> Result<(), MacOsTransportError> {
    let metadata = match fs::symlink_metadata(endpoint) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(source) => {
            return Err(MacOsTransportError::RemoveStaleSocket {
                channel,
                endpoint: endpoint.to_path_buf(),
                source,
            });
        }
    };
    if !metadata.file_type().is_socket() {
        return Err(MacOsTransportError::UnsafeExistingPath {
            channel,
            endpoint: endpoint.to_path_buf(),
        });
    }
    fs::remove_file(endpoint).map_err(|source| MacOsTransportError::RemoveStaleSocket {
        channel,
        endpoint: endpoint.to_path_buf(),
        source,
    })
}

fn bind_socket(
    endpoint: &Path,
    channel: SocketChannel,
) -> Result<UnixListener, MacOsTransportError> {
    let listener = UnixListener::bind(endpoint).map_err(|source| MacOsTransportError::Bind {
        channel,
        endpoint: endpoint.to_path_buf(),
        source,
    })?;
    if let Err(source) = fs::set_permissions(endpoint, fs::Permissions::from_mode(SOCKET_MODE)) {
        drop(listener);
        remove_bound_socket(endpoint);
        return Err(MacOsTransportError::ProtectSocket {
            channel,
            endpoint: endpoint.to_path_buf(),
            source,
        });
    }
    Ok(listener)
}

fn remove_bound_socket(endpoint: &Path) {
    if fs::symlink_metadata(endpoint).is_ok_and(|metadata| metadata.file_type().is_socket()) {
        let _ = fs::remove_file(endpoint);
    }
}
