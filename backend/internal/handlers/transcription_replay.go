package handlers

import (
	"fmt"
	"sync"
	"time"
)

const transcriptionReplayStateTTL = 2 * time.Hour
const transcriptionReplaySweepInterval = 10 * time.Minute

type transcriptionAudioWatermark struct {
	set      bool
	sequence uint64
}

type transcriptionReplaySequenceError struct {
	source   string
	previous uint64
	received uint64
}

func (e *transcriptionReplaySequenceError) Error() string {
	return fmt.Sprintf(
		"audio sequence for %s advanced from %d to %d",
		e.source,
		e.previous,
		e.received,
	)
}

type transcriptionReplaySession struct {
	mu           sync.Mutex
	acknowledged [2]transcriptionAudioWatermark
	lastUsed     time.Time
}

type transcriptionReplayRegistry struct {
	mu        sync.Mutex
	sessions  map[string]*transcriptionReplaySession
	lastSweep time.Time
}

func newTranscriptionReplayRegistry() *transcriptionReplayRegistry {
	return &transcriptionReplayRegistry{sessions: map[string]*transcriptionReplaySession{}}
}

func (r *transcriptionReplayRegistry) process(
	sessionID string,
	frame transcriptionAudioFrame,
	forward func() error,
	acknowledge func() error,
) error {
	state := r.session(sessionID)
	state.mu.Lock()
	defer state.mu.Unlock()

	index := frame.source.providerChannel()
	watermark := state.acknowledged[index]
	if watermark.set && frame.sequence <= watermark.sequence {
		state.lastUsed = time.Now()
		return acknowledge()
	}
	if watermark.set && frame.sequence != watermark.sequence+1 {
		return &transcriptionReplaySequenceError{
			source:   frame.source.clientName(),
			previous: watermark.sequence,
			received: frame.sequence,
		}
	}
	if err := forward(); err != nil {
		return err
	}
	if err := acknowledge(); err != nil {
		return err
	}
	state.acknowledged[index] = transcriptionAudioWatermark{set: true, sequence: frame.sequence}
	state.lastUsed = time.Now()
	return nil
}

func (r *transcriptionReplayRegistry) session(sessionID string) *transcriptionReplaySession {
	now := time.Now()
	r.mu.Lock()
	defer r.mu.Unlock()
	if now.Sub(r.lastSweep) >= transcriptionReplaySweepInterval {
		for id, state := range r.sessions {
			state.mu.Lock()
			expired := now.Sub(state.lastUsed) > transcriptionReplayStateTTL
			state.mu.Unlock()
			if expired {
				delete(r.sessions, id)
			}
		}
		r.lastSweep = now
	}
	state := r.sessions[sessionID]
	if state == nil {
		state = &transcriptionReplaySession{lastUsed: now}
		r.sessions[sessionID] = state
	}
	return state
}
