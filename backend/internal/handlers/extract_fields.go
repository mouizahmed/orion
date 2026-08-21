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
	maxExtractFieldNameLength   = 100
	maxExtractFieldPromptLength = 4000
	maxExtractFieldFolders      = 100
	maxExtractFieldRequestBytes = 64 * 1024
)

type extractFieldRepository interface {
	List(context.Context, string) ([]models.ExtractField, error)
	Create(context.Context, string, repository.ExtractFieldInput) (*models.ExtractField, error)
	Update(context.Context, string, string, repository.ExtractFieldInput) (*models.ExtractField, error)
	Delete(context.Context, string, string) error
}

type ExtractFieldsHandler struct {
	repository extractFieldRepository
	events     resourceevents.Publisher
}

type extractFieldScopeRequest struct {
	Type      string   `json:"type"`
	FolderIDs []string `json:"folder_ids"`
}

type extractFieldRequest struct {
	Name               string                   `json:"name"`
	Prompt             string                   `json:"prompt"`
	InsightCardinality string                   `json:"insight_cardinality"`
	Scope              extractFieldScopeRequest `json:"scope"`
}

type extractFieldValidationError struct {
	Code    string
	Message string
}

func (e *extractFieldValidationError) Error() string { return e.Message }

func NewExtractFieldsHandler(repository extractFieldRepository, events resourceevents.Publisher) *ExtractFieldsHandler {
	return &ExtractFieldsHandler{repository: repository, events: events}
}

func decodeExtractFieldRequest(c *gin.Context) (extractFieldRequest, error) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxExtractFieldRequestBytes)
	decoder := json.NewDecoder(c.Request.Body)
	decoder.DisallowUnknownFields()
	var request extractFieldRequest
	if err := decoder.Decode(&request); err != nil {
		return request, err
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return request, errors.New("request body must contain one JSON value")
	}
	return request, nil
}

func normalizeExtractFieldRequest(request extractFieldRequest) (repository.ExtractFieldInput, error) {
	input := repository.ExtractFieldInput{
		Name:               strings.TrimSpace(request.Name),
		Prompt:             strings.TrimSpace(request.Prompt),
		InsightCardinality: request.InsightCardinality,
		ScopeType:          request.Scope.Type,
		FolderIDs:          []string{},
	}
	if input.Name == "" || utf8.RuneCountInString(input.Name) > maxExtractFieldNameLength {
		return input, &extractFieldValidationError{Code: "extract_field_name_invalid", Message: "Name must be between 1 and 100 characters."}
	}
	if input.Prompt == "" || utf8.RuneCountInString(input.Prompt) > maxExtractFieldPromptLength {
		return input, &extractFieldValidationError{Code: "extract_field_prompt_invalid", Message: "Prompt must be between 1 and 4,000 characters."}
	}
	if input.InsightCardinality != "single" && input.InsightCardinality != "multiple" {
		return input, &extractFieldValidationError{Code: "extract_field_cardinality_invalid", Message: "Number of insights must be Single or Multiple."}
	}
	switch request.Scope.Type {
	case models.ExtractScopeAllMeetings:
		if len(request.Scope.FolderIDs) != 0 {
			return input, &extractFieldValidationError{Code: "extract_field_scope_invalid", Message: "All meetings cannot be combined with folders."}
		}
	case models.ExtractScopeFolders:
		if len(request.Scope.FolderIDs) == 0 || len(request.Scope.FolderIDs) > maxExtractFieldFolders {
			return input, &extractFieldValidationError{Code: "extract_field_scope_invalid", Message: "Choose between 1 and 100 folders."}
		}
		seen := make(map[string]struct{}, len(request.Scope.FolderIDs))
		for _, rawID := range request.Scope.FolderIDs {
			folderID := strings.TrimSpace(rawID)
			if _, err := uuid.Parse(folderID); err != nil {
				return input, &extractFieldValidationError{Code: "extract_field_folder_invalid", Message: "A selected folder is invalid."}
			}
			if _, exists := seen[folderID]; exists {
				return input, &extractFieldValidationError{Code: "extract_field_duplicate_folder", Message: "A folder was selected more than once."}
			}
			seen[folderID] = struct{}{}
			input.FolderIDs = append(input.FolderIDs, folderID)
		}
	default:
		return input, &extractFieldValidationError{Code: "extract_field_scope_invalid", Message: "Meeting scope is invalid."}
	}
	return input, nil
}

func renderExtractFieldRepositoryError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, repository.ErrExtractFieldNotFound):
		c.JSON(http.StatusNotFound, gin.H{"code": "extract_field_not_found", "error": "Extract field not found."})
	case errors.Is(err, repository.ErrExtractFieldFolderUnavailable):
		c.JSON(http.StatusUnprocessableEntity, gin.H{"code": "extract_field_folder_unavailable", "error": "A selected folder is unavailable."})
	case errors.Is(err, repository.ErrExtractFieldNameConflict):
		c.JSON(http.StatusConflict, gin.H{"code": "extract_field_name_conflict", "error": "An extract field with this name already exists."})
	case errors.Is(err, repository.ErrExtractFieldLimitReached):
		c.JSON(http.StatusConflict, gin.H{"code": "extract_field_limit_reached", "error": "You can create up to 100 extract fields."})
	default:
		log.Printf("extract fields: repository operation failed: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update extract fields."})
	}
}

func (h *ExtractFieldsHandler) List(c *gin.Context) {
	accountID, err := getUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
		return
	}
	fields, err := h.repository.List(c.Request.Context(), accountID)
	if err != nil {
		renderExtractFieldRepositoryError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"fields": fields})
}

func (h *ExtractFieldsHandler) Create(c *gin.Context) {
	accountID, err := getUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
		return
	}
	request, err := decodeExtractFieldRequest(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": "invalid_request_payload", "error": "Invalid request payload."})
		return
	}
	input, err := normalizeExtractFieldRequest(request)
	if err != nil {
		validation := err.(*extractFieldValidationError)
		c.JSON(http.StatusUnprocessableEntity, gin.H{"code": validation.Code, "error": validation.Message})
		return
	}
	field, err := h.repository.Create(c.Request.Context(), accountID, input)
	if err != nil {
		renderExtractFieldRepositoryError(c, err)
		return
	}
	resourceevents.PublishBestEffort(c.Request.Context(), h.events, accountID, resourceevents.ResourceExtractFields, &field.ID)
	c.JSON(http.StatusCreated, gin.H{"field": field})
}

func (h *ExtractFieldsHandler) Update(c *gin.Context) {
	accountID, err := getUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
		return
	}
	fieldID := strings.TrimSpace(c.Param("fieldID"))
	if _, err := uuid.Parse(fieldID); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"code": "extract_field_not_found", "error": "Extract field not found."})
		return
	}
	request, err := decodeExtractFieldRequest(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": "invalid_request_payload", "error": "Invalid request payload."})
		return
	}
	input, err := normalizeExtractFieldRequest(request)
	if err != nil {
		validation := err.(*extractFieldValidationError)
		c.JSON(http.StatusUnprocessableEntity, gin.H{"code": validation.Code, "error": validation.Message})
		return
	}
	field, err := h.repository.Update(c.Request.Context(), accountID, fieldID, input)
	if err != nil {
		renderExtractFieldRepositoryError(c, err)
		return
	}
	resourceevents.PublishBestEffort(c.Request.Context(), h.events, accountID, resourceevents.ResourceExtractFields, &field.ID)
	c.JSON(http.StatusOK, gin.H{"field": field})
}

func (h *ExtractFieldsHandler) Delete(c *gin.Context) {
	accountID, err := getUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
		return
	}
	fieldID := strings.TrimSpace(c.Param("fieldID"))
	if _, err := uuid.Parse(fieldID); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"code": "extract_field_not_found", "error": "Extract field not found."})
		return
	}
	if err := h.repository.Delete(c.Request.Context(), accountID, fieldID); err != nil {
		renderExtractFieldRepositoryError(c, err)
		return
	}
	resourceevents.PublishBestEffort(c.Request.Context(), h.events, accountID, resourceevents.ResourceExtractFields, &fieldID)
	c.Status(http.StatusNoContent)
}
