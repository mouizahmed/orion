package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"strings"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/mouizahmed/justscribe-backend/internal/models"
	"github.com/mouizahmed/justscribe-backend/internal/repository"
	"github.com/mouizahmed/justscribe-backend/internal/resourceevents"
)

const (
	maxSummaryTemplateNameLength   = 100
	maxSummaryTemplatePromptLength = 4000
	maxSummaryTemplateFolders      = 100
	maxSummaryTemplateRequestBytes = 64 * 1024
)

type summaryTemplateRepository interface {
	List(context.Context, string) ([]models.SummaryTemplate, error)
	Create(context.Context, string, repository.SummaryTemplateInput) (*models.SummaryTemplate, error)
	Update(context.Context, string, string, repository.SummaryTemplateInput) (*models.SummaryTemplate, error)
	Delete(context.Context, string, string) error
}

type SummaryTemplatesHandler struct {
	repository summaryTemplateRepository
	events     resourceevents.Publisher
}

type summaryTemplateRequest struct {
	Name      string   `json:"name"`
	Prompt    string   `json:"prompt"`
	FolderIDs []string `json:"folder_ids"`
}

type summaryTemplateValidationError struct {
	Code    string
	Message string
}

func (e *summaryTemplateValidationError) Error() string { return e.Message }

func NewSummaryTemplatesHandler(repository summaryTemplateRepository, events resourceevents.Publisher) *SummaryTemplatesHandler {
	return &SummaryTemplatesHandler{repository: repository, events: events}
}

func decodeSummaryTemplateRequest(c *gin.Context) (summaryTemplateRequest, error) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxSummaryTemplateRequestBytes)
	decoder := json.NewDecoder(c.Request.Body)
	decoder.DisallowUnknownFields()
	var request summaryTemplateRequest
	if err := decoder.Decode(&request); err != nil {
		return request, err
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return request, errors.New("request body must contain one JSON value")
	}
	return request, nil
}

func normalizeSummaryTemplateRequest(request summaryTemplateRequest) (repository.SummaryTemplateInput, error) {
	input := repository.SummaryTemplateInput{
		Name: strings.TrimSpace(request.Name), Prompt: strings.TrimSpace(request.Prompt), FolderIDs: []string{},
	}
	if input.Name == "" || utf8.RuneCountInString(input.Name) > maxSummaryTemplateNameLength {
		return input, &summaryTemplateValidationError{Code: "summary_template_name_invalid", Message: "Name must be between 1 and 100 characters."}
	}
	if input.Prompt == "" || utf8.RuneCountInString(input.Prompt) > maxSummaryTemplatePromptLength {
		return input, &summaryTemplateValidationError{Code: "summary_template_prompt_invalid", Message: "Prompt must be between 1 and 4,000 characters."}
	}
	if len(request.FolderIDs) == 0 || len(request.FolderIDs) > maxSummaryTemplateFolders {
		return input, &summaryTemplateValidationError{Code: "summary_template_folders_invalid", Message: "Choose between 1 and 100 folders."}
	}
	seen := make(map[string]struct{}, len(request.FolderIDs))
	for _, rawID := range request.FolderIDs {
		folderID := strings.TrimSpace(rawID)
		if _, err := uuid.Parse(folderID); err != nil {
			return input, &summaryTemplateValidationError{Code: "summary_template_folder_invalid", Message: "A selected folder is invalid."}
		}
		if _, exists := seen[folderID]; exists {
			return input, &summaryTemplateValidationError{Code: "summary_template_duplicate_folder", Message: "A folder was selected more than once."}
		}
		seen[folderID] = struct{}{}
		input.FolderIDs = append(input.FolderIDs, folderID)
	}
	return input, nil
}

func renderSummaryTemplateRepositoryError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, repository.ErrSummaryTemplateNotFound):
		c.JSON(http.StatusNotFound, gin.H{"code": "summary_template_not_found", "error": "Summary template not found."})
	case errors.Is(err, repository.ErrSummaryTemplateFolderUnavailable):
		c.JSON(http.StatusUnprocessableEntity, gin.H{"code": "summary_template_folder_unavailable", "error": "A selected folder is unavailable."})
	case errors.Is(err, repository.ErrSummaryTemplateFolderConflict):
		c.JSON(http.StatusConflict, gin.H{"code": "summary_template_folder_conflict", "error": "A selected folder is already assigned to another summary template."})
	case errors.Is(err, repository.ErrSummaryTemplateNameConflict):
		c.JSON(http.StatusConflict, gin.H{"code": "summary_template_name_conflict", "error": "A summary template with this name already exists."})
	case errors.Is(err, repository.ErrSummaryTemplateLimitReached):
		c.JSON(http.StatusConflict, gin.H{"code": "summary_template_limit_reached", "error": "You can create up to 100 summary templates."})
	default:
		log.Printf("summary templates: repository operation failed: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update summary templates."})
	}
}

func (h *SummaryTemplatesHandler) List(c *gin.Context) {
	accountID, err := getUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
		return
	}
	templates, err := h.repository.List(c.Request.Context(), accountID)
	if err != nil {
		renderSummaryTemplateRepositoryError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"templates": templates})
}

func (h *SummaryTemplatesHandler) Create(c *gin.Context) {
	accountID, err := getUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
		return
	}
	request, err := decodeSummaryTemplateRequest(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": "invalid_request_payload", "error": "Invalid request payload."})
		return
	}
	input, err := normalizeSummaryTemplateRequest(request)
	if err != nil {
		validation := err.(*summaryTemplateValidationError)
		c.JSON(http.StatusUnprocessableEntity, gin.H{"code": validation.Code, "error": validation.Message})
		return
	}
	template, err := h.repository.Create(c.Request.Context(), accountID, input)
	if err != nil {
		renderSummaryTemplateRepositoryError(c, err)
		return
	}
	resourceevents.PublishBestEffort(c.Request.Context(), h.events, accountID, resourceevents.ResourceSummaryTemplates, &template.ID)
	c.JSON(http.StatusCreated, gin.H{"template": template})
}

func (h *SummaryTemplatesHandler) Update(c *gin.Context) {
	accountID, err := getUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
		return
	}
	templateID := strings.TrimSpace(c.Param("templateID"))
	if _, err := uuid.Parse(templateID); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"code": "summary_template_not_found", "error": "Summary template not found."})
		return
	}
	request, err := decodeSummaryTemplateRequest(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": "invalid_request_payload", "error": "Invalid request payload."})
		return
	}
	input, err := normalizeSummaryTemplateRequest(request)
	if err != nil {
		validation := err.(*summaryTemplateValidationError)
		c.JSON(http.StatusUnprocessableEntity, gin.H{"code": validation.Code, "error": validation.Message})
		return
	}
	template, err := h.repository.Update(c.Request.Context(), accountID, templateID, input)
	if err != nil {
		renderSummaryTemplateRepositoryError(c, err)
		return
	}
	resourceevents.PublishBestEffort(c.Request.Context(), h.events, accountID, resourceevents.ResourceSummaryTemplates, &template.ID)
	c.JSON(http.StatusOK, gin.H{"template": template})
}

func (h *SummaryTemplatesHandler) Delete(c *gin.Context) {
	accountID, err := getUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
		return
	}
	templateID := strings.TrimSpace(c.Param("templateID"))
	if _, err := uuid.Parse(templateID); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"code": "summary_template_not_found", "error": "Summary template not found."})
		return
	}
	if err := h.repository.Delete(c.Request.Context(), accountID, templateID); err != nil {
		renderSummaryTemplateRepositoryError(c, err)
		return
	}
	resourceevents.PublishBestEffort(c.Request.Context(), h.events, accountID, resourceevents.ResourceSummaryTemplates, &templateID)
	c.Status(http.StatusNoContent)
}
