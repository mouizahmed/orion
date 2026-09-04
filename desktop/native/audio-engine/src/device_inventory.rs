use cpal::traits::{DeviceTrait, HostTrait};
use cpal::{Device, DeviceId};

use crate::protocol::{AudioDevice, AudioDeviceKind};

const MICROPHONE_ID_PREFIX: &str = "mic:";
const SYSTEM_OUTPUT_ID_PREFIX: &str = "system:";

pub fn list_audio_devices() -> Vec<AudioDevice> {
    let host = cpal::default_host();
    let default_microphone = host
        .default_input_device()
        .and_then(|device| device_id(&device));
    let default_system_output = host
        .default_output_device()
        .and_then(|device| device_id(&device));
    let mut devices = Vec::new();

    if let Ok(inputs) = host.input_devices() {
        devices.extend(collect_devices(
            inputs,
            AudioDeviceKind::Microphone,
            MICROPHONE_ID_PREFIX,
            default_microphone.as_ref(),
        ));
    }
    if let Ok(outputs) = host.output_devices() {
        devices.extend(collect_devices(
            outputs,
            AudioDeviceKind::SystemOutput,
            SYSTEM_OUTPUT_ID_PREFIX,
            default_system_output.as_ref(),
        ));
    }

    devices.sort_by(|left, right| {
        device_kind_order(left.kind)
            .cmp(&device_kind_order(right.kind))
            .then_with(|| right.is_default.cmp(&left.is_default))
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
            .then_with(|| left.id.cmp(&right.id))
    });
    devices
}

fn collect_devices<I>(
    devices: I,
    kind: AudioDeviceKind,
    id_prefix: &str,
    default_id: Option<&DeviceId>,
) -> Vec<AudioDevice>
where
    I: Iterator<Item = Device>,
{
    devices
        .filter_map(move |device| {
            let id = device_id(&device)?;
            let name = device.description().ok()?.name().to_owned();
            Some(AudioDevice {
                id: format!("{id_prefix}{id}"),
                name,
                kind,
                is_default: default_id == Some(&id),
                is_available: true,
            })
        })
        .collect()
}

fn device_id(device: &Device) -> Option<DeviceId> {
    device.id().ok()
}

const fn device_kind_order(kind: AudioDeviceKind) -> u8 {
    match kind {
        AudioDeviceKind::Microphone => 0,
        AudioDeviceKind::SystemOutput => 1,
    }
}
