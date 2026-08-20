package billing

import (
	"context"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
)

type RateLimiter struct {
	redis *redis.Client
}

func NewRateLimiter(client *redis.Client) *RateLimiter {
	return &RateLimiter{redis: client}
}

func (l *RateLimiter) Allow(ctx context.Context, action, accountID string, limit int64, window time.Duration) (bool, error) {
	if l == nil || l.redis == nil || action == "" || accountID == "" || limit <= 0 || window <= 0 {
		return false, fmt.Errorf("billing rate limiter is unavailable")
	}
	key := fmt.Sprintf("billing:rate:%s:%s", action, accountID)
	count, err := l.redis.Eval(ctx, `
		local current = redis.call('INCR', KEYS[1])
		if current == 1 then
			redis.call('PEXPIRE', KEYS[1], ARGV[1])
		end
		return current
	`, []string{key}, window.Milliseconds()).Int64()
	if err != nil {
		return false, fmt.Errorf("apply billing rate limit: %w", err)
	}
	return count <= limit, nil
}

func (l *RateLimiter) ReserveCheckout(ctx context.Context, mode Mode, accountID, requestID string) (bool, error) {
	if l == nil || l.redis == nil {
		return false, fmt.Errorf("billing rate limiter is unavailable")
	}
	key := fmt.Sprintf("billing:checkout-reservation:%s:%s", mode, accountID)
	result, err := l.redis.Eval(ctx, `
		local existing = redis.call('GET', KEYS[1])
		if not existing then
			redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2])
			return 1
		end
		if existing == ARGV[1] then
			return 1
		end
		return 0
	`, []string{key}, requestID, (32 * time.Minute).Milliseconds()).Int()
	if err != nil {
		return false, fmt.Errorf("reserve Stripe Checkout: %w", err)
	}
	return result == 1, nil
}

func (l *RateLimiter) ReleaseCheckoutReservation(ctx context.Context, mode Mode, accountID, requestID string) {
	if l == nil || l.redis == nil {
		return
	}
	key := fmt.Sprintf("billing:checkout-reservation:%s:%s", mode, accountID)
	_, _ = l.redis.Eval(ctx, `
		if redis.call('GET', KEYS[1]) == ARGV[1] then
			return redis.call('DEL', KEYS[1])
		end
		return 0
	`, []string{key}, requestID).Result()
}
