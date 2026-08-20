package models

import "time"

const (
	ExtractScopeAllMeetings = "all_meetings"
	ExtractScopeFolders     = "folders"
)

type ExtractFieldFolder struct {
	ID        string  `json:"id"`
	Name      *string `json:"name"`
	Available bool    `json:"available"`
}

type ExtractFieldScope struct {
	Type    string               `json:"type"`
	Folders []ExtractFieldFolder `json:"folders"`
}

type ExtractField struct {
	ID                 string            `json:"id"`
	AccountID          string            `json:"account_id"`
	Name               string            `json:"name"`
	Prompt             string            `json:"prompt"`
	InsightCardinality string            `json:"insight_cardinality"`
	Scope              ExtractFieldScope `json:"scope"`
	CreatedAt          time.Time         `json:"created_at"`
	UpdatedAt          time.Time         `json:"updated_at"`
}
