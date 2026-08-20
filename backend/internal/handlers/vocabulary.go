package handlers

import (
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"strings"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
	"github.com/mouizahmed/justscribe-backend/internal/repository"
	"github.com/mouizahmed/justscribe-backend/internal/resourceevents"
)

const maxVocabularyTerms = 100
const maxVocabularyTermLength = 50
const maxVocabularyRequestBytes = 64 * 1024

const vocabularyTooManyTermsCode = "vocabulary_too_many_terms"
const vocabularyTermTooLongCode = "vocabulary_term_too_long"

type VocabularyHandler struct {
	repository *repository.AccountVocabularyRepository
	events     resourceevents.Publisher
}

type putVocabularyRequest struct {
	Terms []string `json:"terms"`
}

type vocabularyValidationError struct {
	Code    string
	Message string
}

func (e *vocabularyValidationError) Error() string {
	return e.Message
}

func NewVocabularyHandler(repository *repository.AccountVocabularyRepository, events resourceevents.Publisher) *VocabularyHandler {
	return &VocabularyHandler{repository: repository, events: events}
}

func normalizeVocabularyTerms(terms []string) ([]string, error) {
	normalized := make([]string, 0, len(terms))
	seen := make(map[string]struct{}, len(terms))
	for _, rawTerm := range terms {
		term := strings.TrimSpace(rawTerm)
		if term == "" {
			continue
		}
		if utf8.RuneCountInString(term) > maxVocabularyTermLength {
			return nil, &vocabularyValidationError{
				Code:    vocabularyTermTooLongCode,
				Message: "Each vocabulary term must be 50 characters or fewer.",
			}
		}
		key := strings.ToLower(term)
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		normalized = append(normalized, term)
	}
	if len(normalized) > maxVocabularyTerms {
		return nil, &vocabularyValidationError{
			Code:    vocabularyTooManyTermsCode,
			Message: "Vocabulary can contain at most 100 terms.",
		}
	}
	return normalized, nil
}

func renderVocabulary(c *gin.Context, vocabulary *repository.AccountVocabulary) {
	c.JSON(http.StatusOK, gin.H{"vocabulary": vocabulary})
}

func (h *VocabularyHandler) Get(c *gin.Context) {
	accountID, err := getUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
		return
	}
	vocabulary, err := h.repository.Get(c.Request.Context(), accountID)
	if err != nil {
		log.Printf("vocabulary: failed to load account vocabulary")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to load vocabulary"})
		return
	}
	resourceevents.PublishBestEffort(c.Request.Context(), h.events, accountID, resourceevents.ResourceVocabulary, nil)
	renderVocabulary(c, vocabulary)
}

func (h *VocabularyHandler) Put(c *gin.Context) {
	accountID, err := getUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
		return
	}

	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxVocabularyRequestBytes)
	decoder := json.NewDecoder(c.Request.Body)
	decoder.DisallowUnknownFields()
	var request putVocabularyRequest
	if err := decoder.Decode(&request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": "invalid_request_payload", "error": "Invalid request payload"})
		return
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		c.JSON(http.StatusBadRequest, gin.H{"code": "invalid_request_payload", "error": "Invalid request payload"})
		return
	}

	terms, err := normalizeVocabularyTerms(request.Terms)
	if err != nil {
		var validationError *vocabularyValidationError
		if errors.As(err, &validationError) {
			c.JSON(http.StatusUnprocessableEntity, gin.H{"code": validationError.Code, "error": validationError.Message})
			return
		}
		c.JSON(http.StatusBadRequest, gin.H{"code": "invalid_vocabulary", "error": "Invalid vocabulary"})
		return
	}

	vocabulary, err := h.repository.Put(c.Request.Context(), accountID, terms)
	if err != nil {
		log.Printf("vocabulary: failed to save account vocabulary")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save vocabulary"})
		return
	}
	renderVocabulary(c, vocabulary)
}
