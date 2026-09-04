use std::fmt;

use rubato::audioadapter_buffers::direct::InterleavedSlice;
use rubato::{Fft, FixedSync, Indexing, Resampler};

const INPUT_CHUNK_FRAMES: usize = 960;

/// Allocation-stable mono streaming resampling with an exact final drain.
/// A reset discards pre-gap filter/input state so samples are never blended
/// across a capture discontinuity.
pub struct StreamingResampler {
    input_sample_rate: u32,
    output_sample_rate: u32,
    resampler: Option<Fft<f32>>,
    input: Vec<f32>,
    output: Vec<f32>,
    output_start: usize,
    output_end: usize,
    delay_remaining: usize,
    segment_input_frames: u64,
    segment_output_frames: u64,
}

impl StreamingResampler {
    pub fn new(
        input_sample_rate: u32,
        output_sample_rate: u32,
    ) -> Result<Self, StreamingResamplerError> {
        if input_sample_rate == 0 || output_sample_rate == 0 {
            return Err(StreamingResamplerError::InvalidSampleRate);
        }
        if input_sample_rate == output_sample_rate {
            return Ok(Self {
                input_sample_rate,
                output_sample_rate,
                resampler: None,
                input: Vec::new(),
                output: Vec::with_capacity(1),
                output_start: 0,
                output_end: 0,
                delay_remaining: 0,
                segment_input_frames: 0,
                segment_output_frames: 0,
            });
        }

        let resampler = Fft::<f32>::new(
            input_sample_rate as usize,
            output_sample_rate as usize,
            INPUT_CHUNK_FRAMES,
            1,
            FixedSync::Input,
        )
        .map_err(|error| StreamingResamplerError::Create(error.to_string()))?;
        let delay_remaining = resampler.output_delay();
        let input = Vec::with_capacity(resampler.input_frames_next());
        let output = vec![0.0; resampler.output_frames_max()];
        Ok(Self {
            input_sample_rate,
            output_sample_rate,
            resampler: Some(resampler),
            input,
            output,
            output_start: 0,
            output_end: 0,
            delay_remaining,
            segment_input_frames: 0,
            segment_output_frames: 0,
        })
    }

    pub fn push(&mut self, sample: f32) -> Result<&[f32], StreamingResamplerError> {
        self.segment_input_frames = self.segment_input_frames.saturating_add(1);
        if self.resampler.is_none() {
            self.output.clear();
            self.output.push(sample);
            self.output_start = 0;
            self.output_end = 1;
            self.segment_output_frames = self.segment_output_frames.saturating_add(1);
            return Ok(&self.output);
        }

        self.output_start = 0;
        self.output_end = 0;
        self.input.push(sample);
        let required = self
            .resampler
            .as_ref()
            .expect("resampler presence was checked")
            .input_frames_next();
        if self.input.len() < required {
            return Ok(&self.output[0..0]);
        }
        self.process(None, None)
    }

    /// Flushes the final partial input and pumps the filter delay. The returned
    /// vector contains exactly the remaining ratio-derived output frames.
    pub fn finish(&mut self) -> Result<Vec<f32>, StreamingResamplerError> {
        if self.resampler.is_none() {
            self.output_start = 0;
            self.output_end = 0;
            return Ok(Vec::new());
        }

        let expected = self.expected_segment_output_frames();
        let remaining = expected.saturating_sub(self.segment_output_frames);
        let mut drained = Vec::with_capacity(usize::try_from(remaining).unwrap_or(usize::MAX));
        if !self.input.is_empty() {
            let partial_frames = self.input.len();
            let output = self.process(Some(partial_frames), Some(expected))?;
            drained.extend_from_slice(output);
        }
        while self.segment_output_frames < expected {
            let required = self
                .resampler
                .as_ref()
                .expect("resampler presence was checked")
                .input_frames_next();
            self.input.clear();
            self.input.resize(required, 0.0);
            let before = self.segment_output_frames;
            let output = self.process(Some(0), Some(expected))?;
            drained.extend_from_slice(output);
            if self.segment_output_frames == before {
                return Err(StreamingResamplerError::DrainMadeNoProgress);
            }
        }
        Ok(drained)
    }

    pub fn reset(&mut self) {
        self.input.clear();
        self.output_start = 0;
        self.output_end = 0;
        self.segment_input_frames = 0;
        self.segment_output_frames = 0;
        if let Some(resampler) = self.resampler.as_mut() {
            resampler.reset();
            self.delay_remaining = resampler.output_delay();
        }
    }

    fn process(
        &mut self,
        partial_frames: Option<usize>,
        output_limit: Option<u64>,
    ) -> Result<&[f32], StreamingResamplerError> {
        let resampler = self
            .resampler
            .as_mut()
            .expect("resampling requires a configured resampler");
        let input = InterleavedSlice::new(&self.input, 1, self.input.len())
            .map_err(|error| StreamingResamplerError::Process(error.to_string()))?;
        let output_capacity = self.output.len();
        let mut output = InterleavedSlice::new_mut(&mut self.output, 1, output_capacity)
            .map_err(|error| StreamingResamplerError::Process(error.to_string()))?;
        let indexing = partial_frames.map(|frames| Indexing::new().partial_len(frames));
        let (_, written) = resampler
            .process_into_buffer(&input, &mut output, indexing.as_ref())
            .map_err(|error| StreamingResamplerError::Process(error.to_string()))?;
        self.input.clear();

        let skipped = self.delay_remaining.min(written);
        self.delay_remaining -= skipped;
        let available = written - skipped;
        let allowed = output_limit
            .map(|limit| limit.saturating_sub(self.segment_output_frames))
            .and_then(|frames| usize::try_from(frames).ok())
            .unwrap_or(available)
            .min(available);
        self.output_start = skipped;
        self.output_end = skipped + allowed;
        self.segment_output_frames = self
            .segment_output_frames
            .saturating_add(u64::try_from(allowed).unwrap_or(u64::MAX));
        Ok(&self.output[self.output_start..self.output_end])
    }

    fn expected_segment_output_frames(&self) -> u64 {
        self.segment_input_frames
            .saturating_mul(u64::from(self.output_sample_rate))
            .saturating_add(u64::from(self.input_sample_rate) - 1)
            / u64::from(self.input_sample_rate)
    }
}

#[derive(Debug)]
pub enum StreamingResamplerError {
    InvalidSampleRate,
    Create(String),
    Process(String),
    DrainMadeNoProgress,
}

impl fmt::Display for StreamingResamplerError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidSampleRate => formatter.write_str("sample rate must be positive"),
            Self::Create(error) => write!(formatter, "create resampler: {error}"),
            Self::Process(error) => write!(formatter, "process resampler: {error}"),
            Self::DrainMadeNoProgress => formatter.write_str("resampler drain made no progress"),
        }
    }
}

impl std::error::Error for StreamingResamplerError {}
