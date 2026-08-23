package calendar

import (
	"sync/atomic"
	"time"
)

type SyncMetrics struct {
	Attempts              atomic.Uint64
	Successes             atomic.Uint64
	PartialFailures       atomic.Uint64
	Failures              atomic.Uint64
	CalendarFailures      atomic.Uint64
	TokenRefreshAttempts  atomic.Uint64
	TokenRefreshSuccesses atomic.Uint64
	TokenRefreshFailures  atomic.Uint64
	EventsApplied         atomic.Uint64
	AffectedNotes         atomic.Uint64
	RetentionRuns         atomic.Uint64
	RetentionFailures     atomic.Uint64
	DurationMilliseconds  atomic.Uint64
}

type SyncMetricsSnapshot struct {
	Attempts              uint64 `json:"attempts"`
	Successes             uint64 `json:"successes"`
	PartialFailures       uint64 `json:"partial_failures"`
	Failures              uint64 `json:"failures"`
	CalendarFailures      uint64 `json:"calendar_failures"`
	TokenRefreshAttempts  uint64 `json:"token_refresh_attempts"`
	TokenRefreshSuccesses uint64 `json:"token_refresh_successes"`
	TokenRefreshFailures  uint64 `json:"token_refresh_failures"`
	EventsApplied         uint64 `json:"events_applied"`
	AffectedNotes         uint64 `json:"affected_notes"`
	RetentionRuns         uint64 `json:"retention_runs"`
	RetentionFailures     uint64 `json:"retention_failures"`
	DurationMilliseconds  uint64 `json:"duration_milliseconds"`
}

func (m *SyncMetrics) addDuration(start time.Time) {
	if m != nil {
		m.DurationMilliseconds.Add(uint64(time.Since(start).Milliseconds()))
	}
}

func (m *SyncMetrics) Snapshot() SyncMetricsSnapshot {
	if m == nil {
		return SyncMetricsSnapshot{}
	}
	return SyncMetricsSnapshot{
		Attempts: m.Attempts.Load(), Successes: m.Successes.Load(), PartialFailures: m.PartialFailures.Load(),
		Failures: m.Failures.Load(), CalendarFailures: m.CalendarFailures.Load(),
		TokenRefreshAttempts: m.TokenRefreshAttempts.Load(), TokenRefreshSuccesses: m.TokenRefreshSuccesses.Load(),
		TokenRefreshFailures: m.TokenRefreshFailures.Load(), EventsApplied: m.EventsApplied.Load(),
		AffectedNotes: m.AffectedNotes.Load(), RetentionRuns: m.RetentionRuns.Load(),
		RetentionFailures: m.RetentionFailures.Load(), DurationMilliseconds: m.DurationMilliseconds.Load(),
	}
}
