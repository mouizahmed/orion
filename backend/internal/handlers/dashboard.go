package handlers

import (
	"encoding/base64"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/mouizahmed/justscribe-backend/internal/models"
	"github.com/mouizahmed/justscribe-backend/internal/repository"
)

type DashboardHandler struct {
	noteRepo *repository.NoteRepository
}

type DashboardActivityItem struct {
	ID         string    `json:"id"`
	Type       string    `json:"type"`
	Title      string    `json:"title"`
	ActorLabel string    `json:"actor_label,omitempty"`
	Timestamp  time.Time `json:"timestamp"`
	NoteID     *string   `json:"note_id,omitempty"`
	FolderID   *string   `json:"folder_id,omitempty"`
	Visibility string    `json:"visibility,omitempty"`
	CreatedAt  time.Time `json:"created_at"`
	UpdatedAt  time.Time `json:"updated_at"`
}

func NewDashboardHandler(noteRepo *repository.NoteRepository) *DashboardHandler {
	return &DashboardHandler{noteRepo: noteRepo}
}

func (h *DashboardHandler) ListActivity(c *gin.Context) {
	userID, err := getUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
		return
	}

	limit, err := parseActivityLimit(c.DefaultQuery("limit", "20"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid limit parameter"})
		return
	}

	cursorTime, cursorID, err := parseActivityCursor(strings.TrimSpace(c.Query("cursor")))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid cursor"})
		return
	}

	fetchLimit := limit + 1
	notes, err := h.noteRepo.ListNotesByUserCursor(userID, nil, false, fetchLimit, cursorTime, cursorID)
	if err != nil {
		log.Printf("dashboard: failed to list activity for user %s: %v", userID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load activity"})
		return
	}

	hasMore := false
	var nextCursor *string
	if len(notes) > limit {
		hasMore = true
		notes = notes[:limit]
	}
	if hasMore && len(notes) > 0 {
		last := notes[len(notes)-1]
		rawCursor := fmt.Sprintf("%s|%s", last.UpdatedAt.UTC().Format(time.RFC3339Nano), last.ID)
		encoded := base64.RawURLEncoding.EncodeToString([]byte(rawCursor))
		nextCursor = &encoded
	}

	items := make([]DashboardActivityItem, 0, len(notes))
	for _, note := range notes {
		items = append(items, noteToActivityItem(note))
	}

	c.JSON(http.StatusOK, gin.H{
		"activity": items,
		"pagination": gin.H{
			"limit":       limit,
			"has_more":    hasMore,
			"next_cursor": nextCursor,
		},
	})
}

func parseActivityLimit(raw string) (int, error) {
	limit, err := strconv.Atoi(strings.TrimSpace(raw))
	if err != nil {
		return 0, err
	}
	if limit > 100 {
		limit = 100
	}
	if limit <= 0 {
		limit = 20
	}
	return limit, nil
}

func parseActivityCursor(cursor string) (*time.Time, *string, error) {
	if cursor == "" {
		return nil, nil, nil
	}
	decoded, err := base64.RawURLEncoding.DecodeString(cursor)
	if err != nil {
		return nil, nil, err
	}
	parts := strings.SplitN(string(decoded), "|", 2)
	if len(parts) != 2 {
		return nil, nil, fmt.Errorf("invalid cursor")
	}
	parsed, err := time.Parse(time.RFC3339Nano, parts[0])
	if err != nil {
		return nil, nil, err
	}
	return &parsed, &parts[1], nil
}

func noteToActivityItem(note models.Note) DashboardActivityItem {
	activityType := "note_updated"
	if note.UpdatedAt.Equal(note.CreatedAt) || note.UpdatedAt.Sub(note.CreatedAt) < time.Second {
		activityType = "note_created"
	}
	noteID := note.ID
	return DashboardActivityItem{
		ID:         fmt.Sprintf("%s:%s", activityType, note.ID),
		Type:       activityType,
		Title:      note.Title,
		ActorLabel: "Me",
		Timestamp:  note.UpdatedAt,
		NoteID:     &noteID,
		FolderID:   note.FolderID,
		Visibility: "private",
		CreatedAt:  note.CreatedAt,
		UpdatedAt:  note.UpdatedAt,
	}
}
