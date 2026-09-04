package queue

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
)

const (
	listKey    = "indexer:queue"
	dedupTTL   = 60 * time.Second
	popTimeout = 5 * time.Second
)

// JobType identifies the kind of indexing work.
type JobType string

const (
	JobIndexNote       JobType = "index_note"
	JobIndexTranscript JobType = "index_transcript"
	JobDeleteNote      JobType = "delete_note"
)

// Job is a unit of work for the indexing worker.
type Job struct {
	Type    JobType `json:"type"`
	UserID  string  `json:"user_id"`
	ID      string  `json:"id"`
	DedupID string  `json:"-"`
}

// Queue is a Redis-backed job queue with deduplication.
type Queue struct {
	redis   *redis.Client
	listKey string
}

// NewQueue creates a new Queue.
func NewQueue(redisClient *redis.Client) *Queue {
	return &Queue{redis: redisClient, listKey: listKey}
}

// Enqueue adds a job if no dedup key exists for this (type, id) pair.
func (q *Queue) Enqueue(ctx context.Context, job Job) error {
	dedupID := job.ID
	if job.DedupID != "" {
		dedupID = job.DedupID
	}
	dedupKey := fmt.Sprintf("indexer:dedup:%s:%s", job.Type, dedupID)

	// SetNX returns true if key was set (no duplicate)
	set, err := q.redis.SetNX(ctx, dedupKey, "1", dedupTTL).Result()
	if err != nil {
		return fmt.Errorf("dedup check: %w", err)
	}
	if !set {
		return nil // duplicate within TTL window
	}

	data, err := json.Marshal(job)
	if err != nil {
		_ = q.redis.Del(ctx, dedupKey).Err()
		return fmt.Errorf("marshal job: %w", err)
	}

	if err := q.redis.LPush(ctx, q.listKey, data).Err(); err != nil {
		_ = q.redis.Del(ctx, dedupKey).Err()
		return err
	}
	return nil
}

// Dequeue blocks up to 5 seconds waiting for a job.
// Returns nil, nil on timeout.
func (q *Queue) Dequeue(ctx context.Context) (*Job, error) {
	result, err := q.redis.BRPop(ctx, popTimeout, q.listKey).Result()
	if err == redis.Nil {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("brpop: %w", err)
	}

	// BRPop returns [key, value]
	if len(result) < 2 {
		return nil, nil
	}

	var job Job
	if err := json.Unmarshal([]byte(result[1]), &job); err != nil {
		return nil, fmt.Errorf("unmarshal job: %w", err)
	}
	return &job, nil
}
