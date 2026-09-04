package recordingjanitor

import (
	"context"
	"fmt"
	"log"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/mouizahmed/justscribe-backend/internal/models"
)

const (
	defaultHeartbeatTimeout = 90 * time.Second
	defaultSweepInterval    = 30 * time.Second
	sweepQueryTimeout       = 5 * time.Second
	sweepBatchSize          = 250
	reconciliationBatchSize = 250
)

type sessionRepository interface {
	AbandonStale(context.Context, time.Time, int) ([]models.RecordingSessionIdentity, error)
	FindNonTerminal(context.Context, []models.RecordingSessionIdentity) ([]models.RecordingSessionIdentity, error)
	FindCompleted(context.Context, []models.RecordingSessionIdentity) ([]models.RecordingSessionIdentity, error)
}

type audioCleaner interface {
	Cleanup(userID, sessionID string) error
	CleanupAbandoned(userID, sessionID string) error
	ListSessions() ([]models.RecordingSessionIdentity, error)
}

type Config struct {
	HeartbeatTimeout time.Duration
	SweepInterval    time.Duration
}

type Janitor struct {
	repository sessionRepository
	audio      audioCleaner
	config     Config
}

func LoadConfig() (Config, error) {
	heartbeatTimeout, err := durationFromEnv(
		"RECORDING_SESSION_HEARTBEAT_TIMEOUT",
		defaultHeartbeatTimeout,
		30*time.Second,
		30*time.Minute,
	)
	if err != nil {
		return Config{}, err
	}
	sweepInterval, err := durationFromEnv(
		"RECORDING_SESSION_JANITOR_INTERVAL",
		defaultSweepInterval,
		5*time.Second,
		5*time.Minute,
	)
	if err != nil {
		return Config{}, err
	}
	if sweepInterval > heartbeatTimeout {
		return Config{}, fmt.Errorf("RECORDING_SESSION_JANITOR_INTERVAL must not exceed RECORDING_SESSION_HEARTBEAT_TIMEOUT")
	}
	return Config{HeartbeatTimeout: heartbeatTimeout, SweepInterval: sweepInterval}, nil
}

func New(repository sessionRepository, audio audioCleaner, config Config) *Janitor {
	return &Janitor{repository: repository, audio: audio, config: config}
}

func (j *Janitor) Start(ctx context.Context) {
	if j == nil || j.repository == nil {
		log.Println("recording janitor: repository unavailable, janitor disabled")
		return
	}
	log.Printf(
		"recording janitor: started heartbeat_timeout=%s sweep_interval=%s batch_size=%d",
		j.config.HeartbeatTimeout,
		j.config.SweepInterval,
		sweepBatchSize,
	)

	ticker := time.NewTicker(j.config.SweepInterval)
	defer ticker.Stop()
	for {
		j.sweep(ctx, time.Now().UTC())
		select {
		case <-ctx.Done():
			log.Println("recording janitor: shutting down")
			return
		case <-ticker.C:
		}
	}
}

func (j *Janitor) sweep(parent context.Context, now time.Time) {
	if parent.Err() != nil {
		return
	}
	ctx, cancel := context.WithTimeout(parent, sweepQueryTimeout)
	defer cancel()

	abandoned, err := j.repository.AbandonStale(ctx, now.Add(-j.config.HeartbeatTimeout), sweepBatchSize)
	if err != nil {
		if parent.Err() == nil {
			log.Printf("recording janitor: stale-session sweep failed: %v", err)
		}
		return
	}
	cleanupFailures := 0
	if len(abandoned) > 0 && j.audio != nil {
		for _, session := range abandoned {
			if err := j.audio.CleanupAbandoned(session.UserID, session.ID); err != nil {
				cleanupFailures++
			}
		}
	}
	if len(abandoned) > 0 {
		log.Printf("recording janitor: marked %d stale sessions abandoned", len(abandoned))
	}
	if cleanupFailures > 0 {
		log.Printf("recording janitor: failed to clean audio for %d abandoned sessions", cleanupFailures)
	}
	j.reconcileAudio(ctx)
}

func (j *Janitor) reconcileAudio(ctx context.Context) {
	if j.audio == nil || ctx.Err() != nil {
		return
	}
	candidates, err := j.audio.ListSessions()
	if err != nil {
		log.Printf("recording janitor: audio spool inventory failed: %v", err)
		return
	}
	cleaned := 0
	cleanupFailures := 0
	for offset := 0; offset < len(candidates); offset += reconciliationBatchSize {
		end := min(offset+reconciliationBatchSize, len(candidates))
		batch := candidates[offset:end]
		active, err := j.repository.FindNonTerminal(ctx, batch)
		if err != nil {
			log.Printf("recording janitor: audio spool reconciliation failed: %v", err)
			return
		}
		completed, err := j.repository.FindCompleted(ctx, batch)
		if err != nil {
			log.Printf("recording janitor: audio spool reconciliation failed: %v", err)
			return
		}
		activeKeys := make(map[string]struct{}, len(active))
		for _, session := range active {
			activeKeys[sessionKey(session)] = struct{}{}
		}
		completedKeys := make(map[string]struct{}, len(completed))
		for _, session := range completed {
			completedKeys[sessionKey(session)] = struct{}{}
		}
		for _, session := range batch {
			if _, ok := activeKeys[sessionKey(session)]; ok {
				continue
			}
			var cleanupErr error
			if _, ok := completedKeys[sessionKey(session)]; ok {
				cleanupErr = j.audio.Cleanup(session.UserID, session.ID)
			} else {
				cleanupErr = j.audio.CleanupAbandoned(session.UserID, session.ID)
			}
			if cleanupErr != nil {
				cleanupFailures++
				continue
			}
			cleaned++
		}
	}
	if cleaned > 0 {
		log.Printf("recording janitor: cleaned %d orphaned audio spools", cleaned)
	}
	if cleanupFailures > 0 {
		log.Printf("recording janitor: failed to clean %d orphaned audio spools", cleanupFailures)
	}
}

func sessionKey(session models.RecordingSessionIdentity) string {
	return session.UserID + "/" + session.ID
}

func durationFromEnv(name string, fallback, minimum, maximum time.Duration) (time.Duration, error) {
	raw := strings.TrimSpace(os.Getenv(name))
	if raw == "" {
		return fallback, nil
	}
	if seconds, err := strconv.Atoi(raw); err == nil {
		raw = fmt.Sprintf("%ds", seconds)
	}
	value, err := time.ParseDuration(raw)
	if err != nil || value < minimum || value > maximum {
		return 0, fmt.Errorf("%s must be a duration between %s and %s", name, minimum, maximum)
	}
	return value, nil
}
