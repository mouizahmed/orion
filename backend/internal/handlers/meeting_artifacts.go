package handlers

import (
	"context"
	"errors"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/mouizahmed/justscribe-backend/internal/ai"
	"github.com/mouizahmed/justscribe-backend/internal/models"
	"github.com/mouizahmed/justscribe-backend/internal/repository"
)

type meetingArtifactGenerator interface {
	Generate(context.Context, []*models.TranscriptSegment, string) (*ai.MeetingArtifacts, error)
}

type MeetingArtifactsHandler struct {
	notes       *repository.NoteRepository
	transcripts *repository.TranscriptRepository
	templates   *repository.SummaryTemplateRepository
	generator   meetingArtifactGenerator
}

type meetingArtifactTemplateReference struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type meetingArtifactResponse struct {
	Artifacts       *ai.MeetingArtifacts              `json:"artifacts"`
	SummaryTemplate *meetingArtifactTemplateReference `json:"summary_template"`
}

func NewMeetingArtifactsHandler(
	notes *repository.NoteRepository,
	transcripts *repository.TranscriptRepository,
	templates *repository.SummaryTemplateRepository,
	generator meetingArtifactGenerator,
) *MeetingArtifactsHandler {
	return &MeetingArtifactsHandler{
		notes: notes, transcripts: transcripts, templates: templates, generator: generator,
	}
}

func (h *MeetingArtifactsHandler) Generate(c *gin.Context) {
	accountID, err := getUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
		return
	}
	noteID := strings.TrimSpace(c.Param("noteID"))
	if _, err := uuid.Parse(noteID); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"code": "note_not_found", "error": "Note not found."})
		return
	}
	if h == nil || h.notes == nil || h.transcripts == nil || h.templates == nil || h.generator == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"code": "meeting_artifact_generation_unavailable", "error": "Meeting artifact generation is unavailable."})
		return
	}

	note, err := h.notes.GetNoteByID(accountID, noteID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"code": "note_not_found", "error": "Note not found."})
		return
	}
	segments, err := h.transcripts.GetSegmentsByNote(noteID, accountID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "meeting_transcript_load_failed", "error": "Failed to load the saved transcript."})
		return
	}
	if len(segments) == 0 {
		c.JSON(http.StatusConflict, gin.H{"code": "meeting_transcript_empty", "error": "A saved transcript is required."})
		return
	}

	customInstructions := ""
	var templateReference *meetingArtifactTemplateReference
	if note.FolderID != nil {
		template, err := h.templates.FindForFolder(c.Request.Context(), accountID, *note.FolderID)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"code": "summary_template_load_failed", "error": "Failed to load the summary template."})
			return
		}
		if template != nil {
			customInstructions = template.Prompt
			templateReference = &meetingArtifactTemplateReference{ID: template.ID, Name: template.Name}
		}
	}

	artifacts, err := h.generator.Generate(c.Request.Context(), segments, customInstructions)
	if errors.Is(err, ai.ErrMeetingArtifactInput) {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"code": "meeting_transcript_invalid", "error": "The saved transcript cannot be summarized."})
		return
	}
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"code": "meeting_artifact_generation_failed", "error": "Failed to generate meeting artifacts."})
		return
	}
	c.JSON(http.StatusOK, meetingArtifactResponse{Artifacts: artifacts, SummaryTemplate: templateReference})
}
