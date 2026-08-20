package resourceevents

import "sync"

const (
	MetricPublished       = "resource_events_published_total"
	MetricPublishFailures = "resource_events_publish_failures_total"
	MetricReceived        = "resource_events_received_total"
	MetricInvalid         = "resource_events_invalid_total"
	MetricWSDeliveries    = "resource_events_ws_deliveries_total"
)

type Metrics struct {
	mu     sync.RWMutex
	values map[string]map[string]uint64
}

func NewMetrics() *Metrics {
	return &Metrics{values: make(map[string]map[string]uint64)}
}

func (m *Metrics) Inc(name, label string) {
	m.Add(name, label, 1)
}

func (m *Metrics) Add(name, label string, amount uint64) {
	if m == nil || amount == 0 {
		return
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.values[name] == nil {
		m.values[name] = make(map[string]uint64)
	}
	m.values[name][label] += amount
}

func (m *Metrics) Value(name, label string) uint64 {
	if m == nil {
		return 0
	}
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.values[name][label]
}

func (m *Metrics) Snapshot() map[string]map[string]uint64 {
	result := make(map[string]map[string]uint64)
	if m == nil {
		return result
	}
	m.mu.RLock()
	defer m.mu.RUnlock()
	for name, labels := range m.values {
		result[name] = make(map[string]uint64, len(labels))
		for label, value := range labels {
			result[name][label] = value
		}
	}
	return result
}
