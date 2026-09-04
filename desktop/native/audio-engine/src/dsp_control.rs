use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::{Arc, RwLock};

use crate::protocol::{AudioSource, DspConfiguration, DspSourceTelemetry, DspState};

const VAD_ENABLED: u8 = 1 << 0;
const AGC_ENABLED: u8 = 1 << 1;
const NS_ENABLED: u8 = 1 << 2;
const AEC_ENABLED: u8 = 1 << 3;

#[derive(Clone)]
pub struct DspControl {
    bits: Arc<AtomicU8>,
    telemetry: Arc<RwLock<DspTelemetrySnapshot>>,
}

#[derive(Default)]
struct DspTelemetrySnapshot {
    microphone: DspSourceTelemetry,
    system: DspSourceTelemetry,
}

impl Default for DspControl {
    fn default() -> Self {
        Self::new(DspConfiguration::default())
    }
}

impl DspControl {
    pub fn new(configuration: DspConfiguration) -> Self {
        Self {
            bits: Arc::new(AtomicU8::new(encode(configuration))),
            telemetry: Arc::new(RwLock::new(DspTelemetrySnapshot::default())),
        }
    }

    pub fn configuration(&self) -> DspConfiguration {
        decode(self.bits.load(Ordering::Acquire))
    }

    pub fn set_configuration(&self, configuration: DspConfiguration) {
        self.bits.store(encode(configuration), Ordering::Release);
    }

    pub fn publish(&self, source: AudioSource, telemetry: DspSourceTelemetry) {
        let mut snapshot = self
            .telemetry
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        match source {
            AudioSource::Mic => snapshot.microphone = telemetry,
            AudioSource::System => snapshot.system = telemetry,
        }
    }

    pub fn state(&self, request_id: String) -> DspState {
        let snapshot = self
            .telemetry
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        DspState {
            request_id,
            configuration: self.configuration(),
            microphone: snapshot.microphone,
            system: snapshot.system,
        }
    }
}

const fn encode(configuration: DspConfiguration) -> u8 {
    (if configuration.voice_activity_detection {
        VAD_ENABLED
    } else {
        0
    }) | (if configuration.automatic_gain_control {
        AGC_ENABLED
    } else {
        0
    }) | (if configuration.noise_suppression {
        NS_ENABLED
    } else {
        0
    }) | (if configuration.echo_cancellation {
        AEC_ENABLED
    } else {
        0
    })
}

const fn decode(bits: u8) -> DspConfiguration {
    DspConfiguration {
        voice_activity_detection: bits & VAD_ENABLED != 0,
        automatic_gain_control: bits & AGC_ENABLED != 0,
        noise_suppression: bits & NS_ENABLED != 0,
        echo_cancellation: bits & AEC_ENABLED != 0,
    }
}
