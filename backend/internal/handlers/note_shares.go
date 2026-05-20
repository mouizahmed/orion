package handlers

import (
	"log"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/mouizahmed/justscribe-backend/internal/email"
	"github.com/mouizahmed/justscribe-backend/internal/repository"
)

type NoteSharesHandler struct {
	noteRepo      *repository.NoteRepository
	noteShareRepo *repository.NoteShareRepository
	emailSvc      *email.Service
}

func NewNoteSharesHandler(noteRepo *repository.NoteRepository, noteShareRepo *repository.NoteShareRepository, emailSvc *email.Service) *NoteSharesHandler {
	return &NoteSharesHandler{
		noteRepo:      noteRepo,
		noteShareRepo: noteShareRepo,
		emailSvc:      emailSvc,
	}
}

type CreateShareRequest struct {
	Email string `json:"email"`
	Role  string `json:"role"`
}

type UpdateShareRequest struct {
	Role string `json:"role"`
}

func isValidRole(role string) bool {
	return role == "viewer" || role == "editor"
}

// ListShares handles GET /notes/:noteID/shares
func (h *NoteSharesHandler) ListShares(c *gin.Context) {
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

	shares, err := h.noteShareRepo.ListSharesByNote(noteID)
	if err != nil {
		log.Printf("note_shares: failed to list shares for note %s: %v", noteID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load shares"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"shares": shares})
}

// CreateShare handles POST /notes/:noteID/shares
func (h *NoteSharesHandler) CreateShare(c *gin.Context) {
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

	var req CreateShareRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request payload"})
		return
	}

	req.Email = strings.TrimSpace(req.Email)
	if req.Email == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "email is required"})
		return
	}

	if !isValidRole(req.Role) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "role must be 'viewer' or 'editor'"})
		return
	}

	note, err := h.noteRepo.GetNoteByID(userID, noteID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "note not found"})
		return
	}

	share, err := h.noteShareRepo.UpsertShare(noteID, userID, req.Email, req.Role)
	if err != nil {
		log.Printf("note_shares: failed to upsert share for note %s email %s: %v", noteID, req.Email, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create share"})
		return
	}

	noteTitle := note.Title
	go func() {
		if err := h.emailSvc.SendNoteShareInvite(req.Email, "", noteTitle); err != nil {
			log.Printf("email: note share invite to %s: %v", req.Email, err)
		}
	}()

	c.JSON(http.StatusOK, gin.H{"share": share})
}

// UpdateShare handles PATCH /notes/:noteID/shares/:email
func (h *NoteSharesHandler) UpdateShare(c *gin.Context) {
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

	var req UpdateShareRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request payload"})
		return
	}

	if !isValidRole(req.Role) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "role must be 'viewer' or 'editor'"})
		return
	}

	if _, err := h.noteRepo.GetNoteByID(userID, noteID); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "note not found"})
		return
	}

	share, err := h.noteShareRepo.UpdateShareRole(noteID, email, req.Role)
	if err != nil {
		if strings.Contains(err.Error(), "share not found") {
			c.JSON(http.StatusNotFound, gin.H{"error": "share not found"})
			return
		}
		log.Printf("note_shares: failed to update share for note %s email %s: %v", noteID, email, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update share"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"share": share})
}

// DeleteShare handles DELETE /notes/:noteID/shares/:email
func (h *NoteSharesHandler) DeleteShare(c *gin.Context) {
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

	deleted, err := h.noteShareRepo.DeleteShare(noteID, email)
	if err != nil {
		log.Printf("note_shares: failed to delete share for note %s email %s: %v", noteID, email, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete share"})
		return
	}

	if !deleted {
		c.JSON(http.StatusNotFound, gin.H{"error": "share not found"})
		return
	}

	c.Status(http.StatusNoContent)
}
