package models

import "time"

type SummaryTemplateFolder struct {
	ID        string  `json:"id"`
	Name      *string `json:"name"`
	Available bool    `json:"available"`
}

type SummaryTemplate struct {
	ID        string                  `json:"id"`
	AccountID string                  `json:"account_id"`
	Name      string                  `json:"name"`
	Prompt    string                  `json:"prompt"`
	Folders   []SummaryTemplateFolder `json:"folders"`
	CreatedAt time.Time               `json:"created_at"`
	UpdatedAt time.Time               `json:"updated_at"`
}
