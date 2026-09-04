#![deny(unsafe_op_in_unsafe_fn)]

use std::cell::UnsafeCell;
use std::ffi::c_void;
use std::fmt;
use std::mem::size_of;
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::ptr::NonNull;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::thread;
use std::time::{Duration, Instant};

use objc2::AnyThread;
use objc2::rc::Retained;
use objc2_core_audio::{
    AudioDeviceCreateIOProcID, AudioDeviceDestroyIOProcID, AudioDeviceIOProcID, AudioDeviceStart,
    AudioDeviceStop, AudioHardwareCreateAggregateDevice, AudioHardwareCreateProcessTap,
    AudioHardwareDestroyAggregateDevice, AudioHardwareDestroyProcessTap,
    AudioObjectGetPropertyData, AudioObjectID, AudioObjectPropertyAddress, CATapDescription,
    kAudioAggregateDeviceIsPrivateKey, kAudioAggregateDeviceNameKey,
    kAudioAggregateDeviceTapAutoStartKey, kAudioAggregateDeviceTapListKey,
    kAudioAggregateDeviceUIDKey, kAudioDevicePropertyDeviceIsAlive,
    kAudioObjectPropertyElementMain, kAudioObjectPropertyScopeGlobal,
    kAudioSubTapDriftCompensationKey, kAudioSubTapUIDKey, kAudioTapPropertyFormat,
};
use objc2_core_audio_types::{
    AudioBuffer, AudioBufferList, AudioStreamBasicDescription, AudioTimeStamp,
    kAudioFormatFlagIsFloat, kAudioFormatFlagIsNonInterleaved, kAudioFormatLinearPCM,
};
use objc2_core_foundation::{CFArray, CFBoolean, CFDictionary, CFString, CFType};
use objc2_foundation::{NSArray, NSNumber};
use rtrb::Producer;

const MAX_CHANNELS: u32 = 32;
type OSStatus = i32;
const AUDIO_HARDWARE_NOT_PERMITTED_ERROR: OSStatus = i32::from_be_bytes(*b"nope");
const AGGREGATE_READY_TIMEOUT: Duration = Duration::from_secs(2);
const AGGREGATE_READY_POLL: Duration = Duration::from_millis(10);

#[derive(Debug, Clone, Copy)]
pub struct TapFormat {
    pub sample_rate: u32,
    pub channels: u32,
}

pub struct ProcessTap {
    description: Retained<CATapDescription>,
    tap_id: AudioObjectID,
    aggregate_id: AudioObjectID,
    io_proc: Option<AudioDeviceIOProcID>,
    callback_state: Option<Box<CallbackState>>,
    format: TapFormat,
}

impl ProcessTap {
    pub fn create() -> Result<Self, TapError> {
        let excluded_processes = NSArray::<NSNumber>::new();
        let description = unsafe {
            CATapDescription::initStereoGlobalTapButExcludeProcesses(
                CATapDescription::alloc(),
                &excluded_processes,
            )
        };
        unsafe {
            description.setPrivate(true);
        }

        let mut tap_id = 0;
        check_status("create process tap", unsafe {
            AudioHardwareCreateProcessTap(Some(&description), &mut tap_id)
        })?;

        let result = (|| {
            let native_format = read_tap_format(tap_id)?;
            let format = validate_format(native_format)?;
            let tap_uuid = unsafe { description.UUID().UUIDString() }.to_string();
            let aggregate_id = create_aggregate_device(&tap_uuid)?;
            if let Err(error) = wait_for_aggregate_device(aggregate_id) {
                unsafe {
                    AudioHardwareDestroyAggregateDevice(aggregate_id);
                }
                return Err(error);
            }
            Ok(Self {
                description,
                tap_id,
                aggregate_id,
                io_proc: None,
                callback_state: None,
                format,
            })
        })();

        if result.is_err() {
            unsafe {
                AudioHardwareDestroyProcessTap(tap_id);
            }
        }
        result
    }

    pub const fn format(&self) -> TapFormat {
        self.format
    }

    pub fn start(
        &mut self,
        producer: Producer<f32>,
        runtime_failed: Arc<AtomicBool>,
        discontinuity_pending: Arc<AtomicBool>,
        dropped_audio_frames: Arc<AtomicU64>,
    ) -> Result<(), TapError> {
        if self.io_proc.is_some() {
            return Err(TapError::AlreadyStarted);
        }

        let mut callback_state = Box::new(CallbackState {
            producer: UnsafeCell::new(producer),
            expected_channels: self.format.channels,
            callback_active: AtomicBool::new(false),
            runtime_failed,
            discontinuity_pending,
            dropped_audio_frames,
        });
        let client_data = (&mut *callback_state as *mut CallbackState).cast::<c_void>();
        let mut io_proc = None;
        check_status("create aggregate IO callback", unsafe {
            AudioDeviceCreateIOProcID(
                self.aggregate_id,
                Some(capture_callback),
                client_data,
                NonNull::from(&mut io_proc),
            )
        })?;
        let Some(created_io_proc) = io_proc else {
            return Err(TapError::MissingIoProc);
        };

        if let Err(error) = check_status("start aggregate IO", unsafe {
            AudioDeviceStart(self.aggregate_id, Some(created_io_proc))
        }) {
            unsafe {
                AudioDeviceDestroyIOProcID(self.aggregate_id, Some(created_io_proc));
            }
            return Err(error);
        }

        self.io_proc = Some(Some(created_io_proc));
        self.callback_state = Some(callback_state);
        Ok(())
    }

    pub fn stop(mut self) -> Result<(), TapError> {
        self.stop_io()
    }

    fn stop_io(&mut self) -> Result<(), TapError> {
        let Some(io_proc) = self.io_proc.take() else {
            return Ok(());
        };
        let stop_status = unsafe { AudioDeviceStop(self.aggregate_id, io_proc) };
        let destroy_status = unsafe { AudioDeviceDestroyIOProcID(self.aggregate_id, io_proc) };
        self.callback_state.take();
        check_status("stop aggregate IO", stop_status)?;
        check_status("destroy aggregate IO callback", destroy_status)
    }
}

impl Drop for ProcessTap {
    fn drop(&mut self) {
        let _ = self.stop_io();
        unsafe {
            AudioHardwareDestroyAggregateDevice(self.aggregate_id);
            AudioHardwareDestroyProcessTap(self.tap_id);
        }
        let _ = &self.description;
    }
}

struct CallbackState {
    producer: UnsafeCell<Producer<f32>>,
    expected_channels: u32,
    callback_active: AtomicBool,
    runtime_failed: Arc<AtomicBool>,
    discontinuity_pending: Arc<AtomicBool>,
    dropped_audio_frames: Arc<AtomicU64>,
}

// The callback_active gate below prevents simultaneous access to the SPSC
// producer even if HAL ever overlaps callbacks for this IOProc.
unsafe impl Sync for CallbackState {}

unsafe extern "C-unwind" fn capture_callback(
    _device: AudioObjectID,
    _now: NonNull<AudioTimeStamp>,
    input_data: NonNull<AudioBufferList>,
    _input_time: NonNull<AudioTimeStamp>,
    _output_data: NonNull<AudioBufferList>,
    _output_time: NonNull<AudioTimeStamp>,
    client_data: *mut c_void,
) -> OSStatus {
    let Some(mut state_ptr) = NonNull::new(client_data.cast::<CallbackState>()) else {
        return 0;
    };
    let state = unsafe { state_ptr.as_mut() };
    if state
        .callback_active
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        mark_discontinuity(state);
        return 0;
    }
    let callback_result = catch_unwind(AssertUnwindSafe(|| unsafe {
        copy_input_to_ring(state, input_data.as_ref());
    }));
    state.callback_active.store(false, Ordering::Release);
    if callback_result.is_err() {
        state.runtime_failed.store(true, Ordering::Release);
        mark_discontinuity(state);
    }
    0
}

unsafe fn copy_input_to_ring(state: &CallbackState, input: &AudioBufferList) {
    let buffer_count = input.mNumberBuffers;
    if buffer_count == 0 || buffer_count > MAX_CHANNELS {
        state.runtime_failed.store(true, Ordering::Release);
        mark_discontinuity(state);
        return;
    }

    let buffers =
        unsafe { std::slice::from_raw_parts(input.mBuffers.as_ptr(), buffer_count as usize) };
    let total_channels = buffers.iter().try_fold(0_u32, |total, buffer| {
        total.checked_add(buffer.mNumberChannels)
    });
    if total_channels != Some(state.expected_channels) {
        state.runtime_failed.store(true, Ordering::Release);
        mark_discontinuity(state);
        return;
    }

    let Some(frame_count) = common_frame_count(buffers) else {
        state.runtime_failed.store(true, Ordering::Release);
        mark_discontinuity(state);
        return;
    };
    let required_samples = frame_count.saturating_mul(state.expected_channels as usize);
    let producer = unsafe { &mut *state.producer.get() };
    if producer.slots() < required_samples {
        mark_discontinuity(state);
        return;
    }

    for frame in 0..frame_count {
        for buffer in buffers {
            let Some(data) = NonNull::new(buffer.mData.cast::<f32>()) else {
                state.runtime_failed.store(true, Ordering::Release);
                mark_discontinuity(state);
                return;
            };
            for channel in 0..buffer.mNumberChannels as usize {
                let offset = frame * buffer.mNumberChannels as usize + channel;
                let sample = unsafe { *data.as_ptr().add(offset) };
                if producer.push(sample).is_err() {
                    mark_discontinuity(state);
                    return;
                }
            }
        }
    }
}

fn common_frame_count(buffers: &[AudioBuffer]) -> Option<usize> {
    let mut common = None;
    for buffer in buffers {
        if buffer.mNumberChannels == 0 || buffer.mData.is_null() {
            return None;
        }
        let bytes_per_frame = (buffer.mNumberChannels as usize).checked_mul(size_of::<f32>())?;
        let byte_size = buffer.mDataByteSize as usize;
        if byte_size % bytes_per_frame != 0 {
            return None;
        }
        let frames = byte_size / bytes_per_frame;
        if frames == 0 || common.is_some_and(|existing| existing != frames) {
            return None;
        }
        common = Some(frames);
    }
    common
}

fn mark_discontinuity(state: &CallbackState) {
    state.discontinuity_pending.store(true, Ordering::Release);
    state.dropped_audio_frames.fetch_add(1, Ordering::Relaxed);
}

fn read_tap_format(tap_id: AudioObjectID) -> Result<AudioStreamBasicDescription, TapError> {
    let mut address = AudioObjectPropertyAddress {
        mSelector: kAudioTapPropertyFormat,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain,
    };
    let mut format = AudioStreamBasicDescription {
        mSampleRate: 0.0,
        mFormatID: 0,
        mFormatFlags: 0,
        mBytesPerPacket: 0,
        mFramesPerPacket: 0,
        mBytesPerFrame: 0,
        mChannelsPerFrame: 0,
        mBitsPerChannel: 0,
        mReserved: 0,
    };
    let mut size = u32::try_from(size_of::<AudioStreamBasicDescription>())
        .expect("AudioStreamBasicDescription size fits in u32");
    check_status("read process tap format", unsafe {
        AudioObjectGetPropertyData(
            tap_id,
            NonNull::from(&mut address),
            0,
            std::ptr::null(),
            NonNull::from(&mut size),
            NonNull::from(&mut format).cast(),
        )
    })?;
    if size as usize != size_of::<AudioStreamBasicDescription>() {
        return Err(TapError::InvalidFormat("unexpected format payload size"));
    }
    Ok(format)
}

fn validate_format(format: AudioStreamBasicDescription) -> Result<TapFormat, TapError> {
    if format.mFormatID != kAudioFormatLinearPCM
        || format.mFormatFlags & kAudioFormatFlagIsFloat == 0
        || format.mBitsPerChannel != 32
    {
        return Err(TapError::InvalidFormat(
            "tap is not native-endian Float32 PCM",
        ));
    }
    if !format.mSampleRate.is_finite()
        || format.mSampleRate < 1.0
        || format.mSampleRate > f64::from(u32::MAX)
    {
        return Err(TapError::InvalidFormat("invalid sample rate"));
    }
    if format.mChannelsPerFrame == 0 || format.mChannelsPerFrame > MAX_CHANNELS {
        return Err(TapError::InvalidFormat("invalid channel count"));
    }
    let expected_bytes_per_frame = if format.mFormatFlags & kAudioFormatFlagIsNonInterleaved != 0 {
        size_of::<f32>() as u32
    } else {
        format
            .mChannelsPerFrame
            .checked_mul(size_of::<f32>() as u32)
            .ok_or(TapError::InvalidFormat("bytes per frame overflow"))?
    };
    if format.mBytesPerFrame != expected_bytes_per_frame || format.mFramesPerPacket != 1 {
        return Err(TapError::InvalidFormat("unsupported Float32 PCM layout"));
    }
    Ok(TapFormat {
        sample_rate: format.mSampleRate.round() as u32,
        channels: format.mChannelsPerFrame,
    })
}

fn create_aggregate_device(tap_uuid: &str) -> Result<AudioObjectID, TapError> {
    let tap_uid_key = cf_key(kAudioSubTapUIDKey);
    let drift_key = cf_key(kAudioSubTapDriftCompensationKey);
    let tap_uid = CFString::from_str(tap_uuid);
    let tap_entry = CFDictionary::<CFType, CFType>::from_slices(
        &[tap_uid_key.as_ref(), drift_key.as_ref()],
        &[tap_uid.as_ref(), CFBoolean::new(true).as_ref()],
    );
    let tap_list = CFArray::from_retained_objects(&[tap_entry]);

    let name_key = cf_key(kAudioAggregateDeviceNameKey);
    let uid_key = cf_key(kAudioAggregateDeviceUIDKey);
    let private_key = cf_key(kAudioAggregateDeviceIsPrivateKey);
    let auto_start_key = cf_key(kAudioAggregateDeviceTapAutoStartKey);
    let taps_key = cf_key(kAudioAggregateDeviceTapListKey);
    let name = CFString::from_str("Orion System Audio Tap");
    let aggregate_uid = CFString::from_str(&format!("com.orion.system-audio.{tap_uuid}"));
    let description = CFDictionary::<CFType, CFType>::from_slices(
        &[
            name_key.as_ref(),
            uid_key.as_ref(),
            private_key.as_ref(),
            auto_start_key.as_ref(),
            taps_key.as_ref(),
        ],
        &[
            name.as_ref(),
            aggregate_uid.as_ref(),
            CFBoolean::new(true).as_ref(),
            CFBoolean::new(true).as_ref(),
            tap_list.as_ref(),
        ],
    );
    let mut aggregate_id = 0;
    check_status("create private tap aggregate device", unsafe {
        AudioHardwareCreateAggregateDevice(description.as_ref(), NonNull::from(&mut aggregate_id))
    })?;
    Ok(aggregate_id)
}

fn wait_for_aggregate_device(aggregate_id: AudioObjectID) -> Result<(), TapError> {
    let started = Instant::now();
    loop {
        let mut address = AudioObjectPropertyAddress {
            mSelector: kAudioDevicePropertyDeviceIsAlive,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain,
        };
        let mut is_alive = 0_u32;
        let mut size = size_of::<u32>() as u32;
        let status = unsafe {
            AudioObjectGetPropertyData(
                aggregate_id,
                NonNull::from(&mut address),
                0,
                std::ptr::null(),
                NonNull::from(&mut size),
                NonNull::from(&mut is_alive).cast(),
            )
        };
        if status == 0 && is_alive != 0 {
            return Ok(());
        }
        if started.elapsed() >= AGGREGATE_READY_TIMEOUT {
            return Err(TapError::AggregateNotReady(status));
        }
        thread::sleep(AGGREGATE_READY_POLL);
    }
}

fn cf_key(key: &std::ffi::CStr) -> objc2_core_foundation::CFRetained<CFString> {
    CFString::from_str(key.to_str().expect("Core Audio dictionary keys are UTF-8"))
}

fn check_status(operation: &'static str, status: OSStatus) -> Result<(), TapError> {
    if status == 0 {
        Ok(())
    } else {
        Err(TapError::CoreAudio { operation, status })
    }
}

#[derive(Debug)]
pub enum TapError {
    CoreAudio {
        operation: &'static str,
        status: OSStatus,
    },
    InvalidFormat(&'static str),
    AggregateNotReady(OSStatus),
    AlreadyStarted,
    MissingIoProc,
}

impl fmt::Display for TapError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::CoreAudio { operation, status } => {
                write!(
                    formatter,
                    "Core Audio failed to {operation} (OSStatus {status})"
                )
            }
            Self::InvalidFormat(reason) => {
                write!(formatter, "unsupported Core Audio tap format: {reason}")
            }
            Self::AggregateNotReady(status) => write!(
                formatter,
                "Core Audio aggregate device did not become ready (last OSStatus {status})"
            ),
            Self::AlreadyStarted => {
                formatter.write_str("Core Audio process tap is already started")
            }
            Self::MissingIoProc => {
                formatter.write_str("Core Audio did not return an IO callback ID")
            }
        }
    }
}

impl std::error::Error for TapError {}

impl TapError {
    pub const fn is_permission_denied(&self) -> bool {
        matches!(
            self,
            Self::CoreAudio {
                status: AUDIO_HARDWARE_NOT_PERMITTED_ERROR,
                ..
            } | Self::AggregateNotReady(AUDIO_HARDWARE_NOT_PERMITTED_ERROR)
        )
    }
}
