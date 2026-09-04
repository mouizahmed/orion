use std::fmt;
use std::io::Write;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU8, AtomicU64, Ordering};
use std::sync::mpsc::{Receiver, SyncSender, TrySendError, sync_channel};
use std::thread::{self, JoinHandle};

use crate::audio_codec::{AudioCodecError, AudioFrame, AudioFrameFlags, write_audio_frame};
use crate::protocol::AudioSource;

const AUDIO_FRAME_QUEUE_CAPACITY: usize = 32;

pub struct AudioFrameMux {
    sender: Option<SyncSender<AudioFrameQueueItem>>,
    dropped_audio_frames: Arc<AtomicU64>,
    claimed_sources: AtomicU8,
    writer: Option<JoinHandle<Result<(), AudioFrameWriterError>>>,
}

impl AudioFrameMux {
    pub fn start<W>(
        audio_writer: W,
        dropped_audio_frames: Arc<AtomicU64>,
    ) -> Result<Self, AudioFrameMuxError>
    where
        W: Write + Send + 'static,
    {
        let (sender, receiver) = sync_channel(AUDIO_FRAME_QUEUE_CAPACITY);
        let writer = thread::Builder::new()
            .name("orion-audio-frame-writer".to_owned())
            .spawn(move || run_writer(receiver, audio_writer))
            .map_err(AudioFrameMuxError::SpawnWriter)?;
        Ok(Self {
            sender: Some(sender),
            dropped_audio_frames,
            claimed_sources: AtomicU8::new(0),
            writer: Some(writer),
        })
    }

    pub fn source_sender(
        &self,
        source: AudioSource,
    ) -> Result<AudioFrameSender, AudioFrameMuxError> {
        let source_bit = source_bit(source);
        if self.claimed_sources.fetch_or(source_bit, Ordering::AcqRel) & source_bit != 0 {
            return Err(AudioFrameMuxError::DuplicateSource(source));
        }
        Ok(AudioFrameSender {
            source,
            sender: self
                .sender
                .as_ref()
                .expect("audio frame mux sender is available until shutdown")
                .clone(),
            dropped_audio_frames: Arc::clone(&self.dropped_audio_frames),
            discontinuity_pending: AtomicBool::new(false),
        })
    }

    pub fn stop(mut self) -> Result<(), AudioFrameMuxError> {
        self.stop_inner()
    }

    fn stop_inner(&mut self) -> Result<(), AudioFrameMuxError> {
        if let Some(sender) = self.sender.take() {
            let _ = sender.send(AudioFrameQueueItem::Shutdown);
        }
        let Some(writer) = self.writer.take() else {
            return Ok(());
        };
        writer
            .join()
            .map_err(|_| AudioFrameMuxError::WriterPanicked)?
            .map_err(AudioFrameMuxError::Writer)
    }
}

impl Drop for AudioFrameMux {
    fn drop(&mut self) {
        let _ = self.stop_inner();
    }
}

pub struct AudioFrameSender {
    source: AudioSource,
    sender: SyncSender<AudioFrameQueueItem>,
    dropped_audio_frames: Arc<AtomicU64>,
    discontinuity_pending: AtomicBool,
}

impl AudioFrameSender {
    pub fn submit(&self, mut frame: AudioFrame) -> Result<FrameSubmission, AudioFrameSendError> {
        if frame.source != self.source {
            return Err(AudioFrameSendError::SourceMismatch {
                expected: self.source,
                received: frame.source,
            });
        }
        if self.discontinuity_pending.swap(false, Ordering::AcqRel) {
            frame.flags = frame.flags.union(AudioFrameFlags::DISCONTINUITY);
        }
        match self.sender.try_send(AudioFrameQueueItem::Frame(frame)) {
            Ok(()) => Ok(FrameSubmission::Submitted),
            Err(TrySendError::Full(_)) => {
                self.dropped_audio_frames.fetch_add(1, Ordering::Relaxed);
                self.discontinuity_pending.store(true, Ordering::Release);
                Ok(FrameSubmission::Dropped)
            }
            Err(TrySendError::Disconnected(_)) => Err(AudioFrameSendError::WriterDisconnected),
        }
    }
}

enum AudioFrameQueueItem {
    Frame(AudioFrame),
    Shutdown,
}

const fn source_bit(source: AudioSource) -> u8 {
    match source {
        AudioSource::Mic => 1 << 0,
        AudioSource::System => 1 << 1,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FrameSubmission {
    Submitted,
    Dropped,
}

fn run_writer<W>(
    receiver: Receiver<AudioFrameQueueItem>,
    mut audio_writer: W,
) -> Result<(), AudioFrameWriterError>
where
    W: Write,
{
    while let Ok(item) = receiver.recv() {
        match item {
            AudioFrameQueueItem::Frame(frame) => {
                write_audio_frame(&mut audio_writer, &frame)
                    .map_err(AudioFrameWriterError::WriteAudio)?;
            }
            AudioFrameQueueItem::Shutdown => break,
        }
    }
    audio_writer.flush().map_err(AudioFrameWriterError::Flush)
}

#[derive(Debug)]
pub enum AudioFrameMuxError {
    SpawnWriter(std::io::Error),
    DuplicateSource(AudioSource),
    WriterPanicked,
    Writer(AudioFrameWriterError),
}

impl fmt::Display for AudioFrameMuxError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::SpawnWriter(error) => write!(formatter, "failed to spawn audio writer: {error}"),
            Self::DuplicateSource(source) => {
                write!(
                    formatter,
                    "audio frame sender already exists for {source:?}"
                )
            }
            Self::WriterPanicked => formatter.write_str("audio writer panicked"),
            Self::Writer(error) => write!(formatter, "audio writer failed: {error}"),
        }
    }
}

impl std::error::Error for AudioFrameMuxError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::SpawnWriter(error) => Some(error),
            Self::Writer(error) => Some(error),
            Self::DuplicateSource(_) | Self::WriterPanicked => None,
        }
    }
}

#[derive(Debug)]
pub enum AudioFrameSendError {
    SourceMismatch {
        expected: AudioSource,
        received: AudioSource,
    },
    WriterDisconnected,
}

impl fmt::Display for AudioFrameSendError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::SourceMismatch { expected, received } => write!(
                formatter,
                "audio frame source {received:?} does not match sender source {expected:?}",
            ),
            Self::WriterDisconnected => formatter.write_str("audio writer is disconnected"),
        }
    }
}

impl std::error::Error for AudioFrameSendError {}

#[derive(Debug)]
pub enum AudioFrameWriterError {
    WriteAudio(AudioCodecError),
    Flush(std::io::Error),
}

impl fmt::Display for AudioFrameWriterError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::WriteAudio(error) => write!(formatter, "audio frame write failed: {error}"),
            Self::Flush(error) => write!(formatter, "audio channel flush failed: {error}"),
        }
    }
}

impl std::error::Error for AudioFrameWriterError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::WriteAudio(error) => Some(error),
            Self::Flush(error) => Some(error),
        }
    }
}
