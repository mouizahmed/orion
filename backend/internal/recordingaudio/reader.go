package recordingaudio

import (
	"context"
	"encoding/binary"
	"errors"
	"fmt"
	"hash/crc32"
	"io"
	"os"
)

// CopyPCM validates a sealed spool and streams only its PCM16 payloads.
func CopyPCM(ctx context.Context, path string, source Source, destination io.Writer) (int64, error) {
	if source != SourceMicrophone && source != SourceSystem {
		return 0, errors.New("recording audio source is invalid")
	}
	file, err := os.Open(path)
	if err != nil {
		return 0, fmt.Errorf("open recording audio spool for reading: %w", err)
	}
	defer file.Close()

	header := make([]byte, recordHeaderBytes)
	payload := make([]byte, maxFrameBytes)
	var expectedSequence uint64
	var copied int64
	for {
		if err := ctx.Err(); err != nil {
			return copied, err
		}
		_, err := io.ReadFull(file, header)
		if errors.Is(err, io.EOF) {
			return copied, nil
		}
		if err != nil {
			return copied, fmt.Errorf("read recording audio spool header: %w", err)
		}
		length := int(binary.LittleEndian.Uint32(header[16:20]))
		sequence := binary.LittleEndian.Uint64(header[8:16])
		if string(header[0:4]) != recordMagic || header[4] != recordVersion ||
			header[5] != byte(source) || length <= 0 || length > maxFrameBytes ||
			length%2 != 0 || sequence != expectedSequence {
			return copied, errors.New("recording audio spool record is invalid")
		}
		frame := payload[:length]
		if _, err := io.ReadFull(file, frame); err != nil {
			return copied, fmt.Errorf("read recording audio spool payload: %w", err)
		}
		if crc32.ChecksumIEEE(frame) != binary.LittleEndian.Uint32(header[20:24]) {
			return copied, errors.New("recording audio spool checksum is invalid")
		}
		written, err := destination.Write(frame)
		copied += int64(written)
		if err != nil {
			return copied, fmt.Errorf("write recording PCM stream: %w", err)
		}
		if written != len(frame) {
			return copied, io.ErrShortWrite
		}
		expectedSequence++
	}
}
