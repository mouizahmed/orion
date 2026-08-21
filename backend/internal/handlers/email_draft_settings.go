package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
	"github.com/mouizahmed/justscribe-backend/internal/repository"
	"github.com/mouizahmed/justscribe-backend/internal/resourceevents"
)

const maxEmailDraftPromptLength = 1000
const maxEmailDraftSettingsRequestBytes = 16 * 1024

const defaultEmailDraftPrompt = `Rules
- Be concise and straight to the point. Less than 3 paragraphs.
- Include a quick recap of key points, and last paragraph should be a call to action (next steps) with explicit responsibility and due date (if mentioned).
- Include only what matters to the buyer.

Template
Subject: Following up - (my first name) <> (buyer first name)
Body:
Hi (buyer name),

(greeting)

Here's a quick recap of the meeting:
- (conversation summary, 3 bullet points)

(naturally ask for follow-up or call-to-action, if there's any. 1-2 sentences max.)

Best,
(my first name)`

type emailDraftSettingsRepository interface {
	Get(context.Context, string) (*repository.EmailDraftSettings, error)
	Patch(context.Context, string, repository.EmailDraftSettingsPatch, string) (*repository.EmailDraftSettings, error)
}

type EmailDraftSettingsHandler struct {
	repository emailDraftSettingsRepository
	events     resourceevents.Publisher
}

type patchEmailDraftSettingsRequest struct {
	Enabled            *bool   `json:"enabled"`
	IncludeSharingLink *bool   `json:"include_sharing_link"`
	DraftPrompt        *string `json:"draft_prompt"`
}

func NewEmailDraftSettingsHandler(repository emailDraftSettingsRepository, events resourceevents.Publisher) *EmailDraftSettingsHandler {
	return &EmailDraftSettingsHandler{repository: repository, events: events}
}

func defaultEmailDraftSettings() *repository.EmailDraftSettings {
	return &repository.EmailDraftSettings{
		Enabled:            true,
		IncludeSharingLink: true,
		DraftPrompt:        defaultEmailDraftPrompt,
	}
}

func decodeEmailDraftSettingsPatch(c *gin.Context) (repository.EmailDraftSettingsPatch, string, error) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxEmailDraftSettingsRequestBytes)
	decoder := json.NewDecoder(c.Request.Body)
	decoder.DisallowUnknownFields()
	var request patchEmailDraftSettingsRequest
	if err := decoder.Decode(&request); err != nil {
		return repository.EmailDraftSettingsPatch{}, "invalid_request_payload", err
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return repository.EmailDraftSettingsPatch{}, "invalid_request_payload", errors.New("request body must contain one JSON value")
	}
	if request.Enabled == nil && request.IncludeSharingLink == nil && request.DraftPrompt == nil {
		return repository.EmailDraftSettingsPatch{}, "email_draft_settings_empty_update", errors.New("at least one setting is required")
	}
	if request.DraftPrompt != nil && utf8.RuneCountInString(*request.DraftPrompt) > maxEmailDraftPromptLength {
		return repository.EmailDraftSettingsPatch{}, "email_draft_prompt_too_long", errors.New("draft prompt must be 1,000 characters or fewer")
	}
	return repository.EmailDraftSettingsPatch{
		Enabled:            request.Enabled,
		IncludeSharingLink: request.IncludeSharingLink,
		DraftPrompt:        request.DraftPrompt,
	}, "", nil
}

func renderEmailDraftSettings(c *gin.Context, settings *repository.EmailDraftSettings) {
	c.JSON(http.StatusOK, gin.H{"settings": settings})
}

func (h *EmailDraftSettingsHandler) Get(c *gin.Context) {
	accountID, err := getUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
		return
	}
	settings, err := h.repository.Get(c.Request.Context(), accountID)
	if errors.Is(err, repository.ErrEmailDraftSettingsNotFound) {
		renderEmailDraftSettings(c, defaultEmailDraftSettings())
		return
	}
	if err != nil {
		log.Printf("email draft settings: failed to load settings")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to load email draft settings."})
		return
	}
	renderEmailDraftSettings(c, settings)
}

func (h *EmailDraftSettingsHandler) Patch(c *gin.Context) {
	accountID, err := getUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
		return
	}
	patch, code, err := decodeEmailDraftSettingsPatch(c)
	if err != nil {
		status := http.StatusBadRequest
		message := "Invalid request payload."
		if code == "email_draft_settings_empty_update" || code == "email_draft_prompt_too_long" {
			status = http.StatusUnprocessableEntity
			message = err.Error()
		}
		c.JSON(status, gin.H{"code": code, "error": message})
		return
	}
	settings, err := h.repository.Patch(c.Request.Context(), accountID, patch, defaultEmailDraftPrompt)
	if err != nil {
		log.Printf("email draft settings: failed to update settings")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update email draft settings."})
		return
	}
	resourceevents.PublishBestEffort(c.Request.Context(), h.events, accountID, resourceevents.ResourceEmailDraftSettings, nil)
	renderEmailDraftSettings(c, settings)
}
