package handlers

import (
	"encoding/binary"
	"fmt"
	"math"
)

const (
	transcriptionAudioProtocolVersion = 1
	transcriptionAudioHeaderBytes     = 40
	transcriptionAudioChannels        = 1
	transcriptionAudioPCM16LE         = 1
	transcriptionAudioMutedFlag       = 1 << 0
	transcriptionAudioDiscontinuity   = 1 << 1
	transcriptionAudioKnownFlags      = transcriptionAudioMutedFlag | transcriptionAudioDiscontinuity
)

var transcriptionAudioMagic = [4]byte{'O', 'R', 'A', '1'}

type transcriptionAudioSource uint8

const (
	transcriptionAudioSourceMic    transcriptionAudioSource = 1
	transcriptionAudioSourceSystem transcriptionAudioSource = 2
)

func (source transcriptionAudioSource) providerChannel() int {
	return int(source) - 1
}

func (source transcriptionAudioSource) clientName() string {
	if source == transcriptionAudioSourceSystem {
		return "system"
	}
	return "microphone"
}

type transcriptionAudioFrame struct {
	source        transcriptionAudioSource
	voiceActivity uint8
	flags         uint8
	sequence      uint64
	timestampUS   uint64
	frameCount    uint32
	rms           float32
	pcm           []byte
}

func decodeTranscriptionAudioFrame(payload []byte) (transcriptionAudioFrame, error) {
	if len(payload) > maxWSMessageBytes {
		return transcriptionAudioFrame{}, fmt.Errorf(
			"audio payload has %d bytes; maximum is %d",
			len(payload),
			maxWSMessageBytes,
		)
	}
	if len(payload) < transcriptionAudioHeaderBytes {
		return transcriptionAudioFrame{}, fmt.Errorf(
			"audio payload has %d bytes; header requires %d",
			len(payload),
			transcriptionAudioHeaderBytes,
		)
	}
	if [4]byte(payload[:4]) != transcriptionAudioMagic {
		return transcriptionAudioFrame{}, fmt.Errorf("audio payload has invalid magic")
	}
	if payload[4] != transcriptionAudioProtocolVersion {
		return transcriptionAudioFrame{}, fmt.Errorf(
			"audio protocol version is %d; expected %d",
			payload[4],
			transcriptionAudioProtocolVersion,
		)
	}

	source := transcriptionAudioSource(payload[5])
	if source != transcriptionAudioSourceMic && source != transcriptionAudioSourceSystem {
		return transcriptionAudioFrame{}, fmt.Errorf("audio source is invalid: %d", payload[5])
	}
	voiceActivity := payload[6]
	if voiceActivity > 2 {
		return transcriptionAudioFrame{}, fmt.Errorf("audio voice activity state is invalid: %d", voiceActivity)
	}
	flags := payload[7]
	if flags & ^uint8(transcriptionAudioKnownFlags) != 0 {
		return transcriptionAudioFrame{}, fmt.Errorf("audio frame has unknown flags: %#02x", flags)
	}

	sampleRate := binary.LittleEndian.Uint32(payload[24:28])
	if sampleRate != uint32(transcriptionSampleRate) {
		return transcriptionAudioFrame{}, fmt.Errorf(
			"audio sample rate is %d; expected %d",
			sampleRate,
			transcriptionSampleRate,
		)
	}
	channels := binary.LittleEndian.Uint16(payload[28:30])
	if channels != transcriptionAudioChannels {
		return transcriptionAudioFrame{}, fmt.Errorf(
			"audio channel count is %d; expected %d",
			channels,
			transcriptionAudioChannels,
		)
	}
	sampleFormat := binary.LittleEndian.Uint16(payload[30:32])
	if sampleFormat != transcriptionAudioPCM16LE {
		return transcriptionAudioFrame{}, fmt.Errorf("audio sample format is invalid: %d", sampleFormat)
	}
	frameCount := binary.LittleEndian.Uint32(payload[32:36])
	if frameCount == 0 {
		return transcriptionAudioFrame{}, fmt.Errorf("audio PCM payload is empty")
	}
	rms := math.Float32frombits(binary.LittleEndian.Uint32(payload[36:40]))
	if math.IsNaN(float64(rms)) || math.IsInf(float64(rms), 0) || rms < 0 || rms > 1 {
		return transcriptionAudioFrame{}, fmt.Errorf("audio RMS level is invalid")
	}

	expectedBytes := uint64(transcriptionAudioHeaderBytes) +
		uint64(frameCount)*uint64(channels)*uint64(2)
	if uint64(len(payload)) != expectedBytes {
		return transcriptionAudioFrame{}, fmt.Errorf(
			"audio payload has %d bytes; header declares %d",
			len(payload),
			expectedBytes,
		)
	}

	return transcriptionAudioFrame{
		source:        source,
		voiceActivity: voiceActivity,
		flags:         flags,
		sequence:      binary.LittleEndian.Uint64(payload[8:16]),
		timestampUS:   binary.LittleEndian.Uint64(payload[16:24]),
		frameCount:    frameCount,
		rms:           rms,
		pcm:           payload[transcriptionAudioHeaderBytes:],
	}, nil
}
