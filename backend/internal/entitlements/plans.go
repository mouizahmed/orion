package entitlements

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/mouizahmed/justscribe-backend/internal/models"
)

type MeterKey string

const (
	MeterTranscriptionSeconds MeterKey = "transcription_seconds"
)

type PeriodKind string

const (
	PeriodUTCMonth PeriodKind = "utc_month"
)

type MeterLimit struct {
	IncludedQuantity int64
	Period           PeriodKind
}

type PlanDefinition struct {
	Key         models.UserPlan
	MeterLimits map[MeterKey]MeterLimit
}

type UsagePeriod struct {
	StartedAt time.Time
	EndsAt    time.Time
}

type CatalogPlan struct {
	Key                          models.UserPlan `json:"key"`
	Name                         string          `json:"name"`
	IncludedTranscriptionMinutes int64           `json:"includedTranscriptionMinutes"`
	Features                     []string        `json:"features"`
	Marketed                     *bool           `json:"marketed,omitempty"`
}

type CatalogOffer struct {
	Key             string          `json:"key"`
	PlanKey         models.UserPlan `json:"planKey"`
	Currency        string          `json:"currency"`
	UnitAmountCents int64           `json:"unitAmountCents"`
	Interval        string          `json:"interval"`
	TrialDays       int64           `json:"trialDays"`
}

type Catalog struct {
	Plans  []CatalogPlan  `json:"plans"`
	Offers []CatalogOffer `json:"offers"`
}

//go:embed catalog.json
var catalogJSON []byte

var catalog, definitions = loadCatalog()

func loadCatalog() (Catalog, map[models.UserPlan]PlanDefinition) {
	var result Catalog
	if err := json.Unmarshal(catalogJSON, &result); err != nil {
		panic(fmt.Sprintf("decode embedded product catalog: %v", err))
	}
	definitions := make(map[models.UserPlan]PlanDefinition, len(result.Plans))
	for _, plan := range result.Plans {
		if !knownPlanKey(plan.Key) || strings.TrimSpace(plan.Name) == "" || plan.IncludedTranscriptionMinutes < 0 {
			panic("embedded product catalog contains an invalid plan")
		}
		for _, feature := range plan.Features {
			if strings.TrimSpace(feature) == "" {
				panic("embedded product catalog contains an empty feature")
			}
		}
		if _, exists := definitions[plan.Key]; exists {
			panic("embedded product catalog contains a duplicate plan")
		}
		definitions[plan.Key] = PlanDefinition{
			Key: plan.Key,
			MeterLimits: map[MeterKey]MeterLimit{
				MeterTranscriptionSeconds: {
					IncludedQuantity: plan.IncludedTranscriptionMinutes * 60,
					Period:           PeriodUTCMonth,
				},
			},
		}
	}
	offerKeys := make(map[string]struct{}, len(result.Offers))
	for _, offer := range result.Offers {
		if strings.TrimSpace(offer.Key) == "" || offer.Currency != "usd" || offer.UnitAmountCents <= 0 ||
			(offer.Interval != "month" && offer.Interval != "year") || offer.TrialDays < 0 {
			panic("embedded product catalog contains an invalid offer")
		}
		if _, exists := definitions[offer.PlanKey]; !exists {
			panic("embedded product catalog offer references an unknown plan")
		}
		if _, exists := offerKeys[offer.Key]; exists {
			panic("embedded product catalog contains a duplicate offer")
		}
		offerKeys[offer.Key] = struct{}{}
	}
	return result, definitions
}

func knownPlanKey(key models.UserPlan) bool {
	switch key {
	case models.UserPlanFree, models.UserPlanPro, models.UserPlanBusiness:
		return true
	default:
		return false
	}
}

func ProductCatalog() Catalog {
	result := Catalog{
		Plans:  make([]CatalogPlan, len(catalog.Plans)),
		Offers: make([]CatalogOffer, len(catalog.Offers)),
	}
	copy(result.Offers, catalog.Offers)
	for i, plan := range catalog.Plans {
		result.Plans[i] = plan
		result.Plans[i].Features = append([]string(nil), plan.Features...)
	}
	return result
}

func ResolvePlan(key models.UserPlan) (PlanDefinition, error) {
	definition, ok := definitions[key]
	if !ok {
		return PlanDefinition{}, fmt.Errorf("unknown plan key %q", key)
	}

	copyDefinition := PlanDefinition{
		Key:         definition.Key,
		MeterLimits: make(map[MeterKey]MeterLimit, len(definition.MeterLimits)),
	}
	for meter, limit := range definition.MeterLimits {
		copyDefinition.MeterLimits[meter] = limit
	}
	return copyDefinition, nil
}

func ResolveMeterLimit(plan models.UserPlan, meter MeterKey) (MeterLimit, error) {
	definition, err := ResolvePlan(plan)
	if err != nil {
		return MeterLimit{}, err
	}
	limit, ok := definition.MeterLimits[meter]
	if !ok {
		return MeterLimit{}, fmt.Errorf("unknown meter key %q for plan %q", meter, plan)
	}
	if limit.IncludedQuantity < 0 {
		return MeterLimit{}, fmt.Errorf("invalid meter limit for %q on plan %q", meter, plan)
	}
	return limit, nil
}

func PeriodFor(limit MeterLimit, at time.Time) (UsagePeriod, error) {
	switch limit.Period {
	case PeriodUTCMonth:
		utc := at.UTC()
		startedAt := time.Date(utc.Year(), utc.Month(), 1, 0, 0, 0, 0, time.UTC)
		return UsagePeriod{StartedAt: startedAt, EndsAt: startedAt.AddDate(0, 1, 0)}, nil
	default:
		return UsagePeriod{}, fmt.Errorf("unknown usage period kind %q", limit.Period)
	}
}
