package handlers

import (
	"log"
	"net/http"
	"regexp"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/mouizahmed/justscribe-backend/internal/repository"
)

var emailRegex = regexp.MustCompile(`^[^\s@]+@[^\s@]+\.[^\s@]+$`)

type NoteAttendeesHandler struct {
	noteRepo         *repository.NoteRepository
	noteAttendeeRepo *repository.NoteAttendeeRepository
}

func NewNoteAttendeesHandler(noteRepo *repository.NoteRepository, noteAttendeeRepo *repository.NoteAttendeeRepository) *NoteAttendeesHandler {
	return &NoteAttendeesHandler{
		noteRepo:         noteRepo,
		noteAttendeeRepo: noteAttendeeRepo,
	}
}

type AddAttendeeRequest struct {
	Email string `json:"email"`
}

// ListAttendees handles GET /notes/:noteID/attendees
func (h *NoteAttendeesHandler) ListAttendees(c *gin.Context) {
	userID, err := getUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
		return
	}

	noteID := strings.TrimSpace(c.Param("noteID"))
	if noteID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "note id is required"})
		return
	}

	if _, err := h.noteRepo.GetNoteByID(userID, noteID); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "note not found"})
		return
	}

	attendees, err := h.noteAttendeeRepo.ListByNote(noteID)
	if err != nil {
		log.Printf("note_attendees: failed to list attendees for note %s: %v", noteID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load attendees"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"attendees": attendees})
}

// AddAttendee handles POST /notes/:noteID/attendees
func (h *NoteAttendeesHandler) AddAttendee(c *gin.Context) {
	userID, err := getUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
		return
	}

	noteID := strings.TrimSpace(c.Param("noteID"))
	if noteID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "note id is required"})
		return
	}

	var req AddAttendeeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request payload"})
		return
	}

	req.Email = strings.ToLower(strings.TrimSpace(req.Email))
	if req.Email == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "email is required"})
		return
	}
	if !emailRegex.MatchString(req.Email) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid email address"})
		return
	}

	if _, err := h.noteRepo.GetNoteByID(userID, noteID); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "note not found"})
		return
	}

	attendee, err := h.noteAttendeeRepo.Add(noteID, req.Email)
	if err != nil {
		log.Printf("note_attendees: failed to add attendee %s to note %s: %v", req.Email, noteID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to add attendee"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"attendee": attendee})
}

// RemoveAttendee handles DELETE /notes/:noteID/attendees/:email
func (h *NoteAttendeesHandler) RemoveAttendee(c *gin.Context) {
	userID, err := getUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
		return
	}

	noteID := strings.TrimSpace(c.Param("noteID"))
	if noteID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "note id is required"})
		return
	}

	email := strings.TrimSpace(c.Param("email"))
	if email == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "email is required"})
		return
	}

	if _, err := h.noteRepo.GetNoteByID(userID, noteID); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "note not found"})
		return
	}

	deleted, err := h.noteAttendeeRepo.Remove(noteID, email)
	if err != nil {
		log.Printf("note_attendees: failed to remove attendee %s from note %s: %v", email, noteID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to remove attendee"})
		return
	}

	if !deleted {
		c.JSON(http.StatusNotFound, gin.H{"error": "attendee not found"})
		return
	}

	c.Status(http.StatusNoContent)
}
