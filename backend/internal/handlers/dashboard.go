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
	Title      string    `json:"title"`
	ActorLabel string    `json:"actor_label,omitempty"`
	Timestamp  time.Time `json:"timestamp"`
	NoteID     *string   `json:"note_id,omitempty"`
	FolderID   *string   `json:"folder_id,omitempty"`
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

	sortBy, err := parseNoteSort(c.DefaultQuery("sort", "updated"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid sort parameter"})
		return
	}

	direction, err := parseSortDirection(c.DefaultQuery("direction", "desc"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid direction parameter"})
		return
	}

	cursorSortValue, cursorID, err := parseActivityCursor(strings.TrimSpace(c.Query("cursor")))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid cursor"})
		return
	}

	fetchLimit := limit + 1
	notes, err := h.noteRepo.ListActivityNotesByUser(userID, repository.NoteActivityQuery{
		Sort:            sortBy,
		Direction:       direction,
		Limit:           fetchLimit,
		CursorSortValue: cursorSortValue,
		CursorID:        cursorID,
	})
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
		rawCursor := fmt.Sprintf("%s|%s", activityCursorValue(last, sortBy), last.ID)
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
			"sort":        sortBy,
			"direction":   direction,
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

func parseNoteSort(raw string) (string, error) {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "", "updated":
		return "updated", nil
	case "created":
		return "created", nil
	case "title":
		return "title", nil
	default:
		return "", fmt.Errorf("unsupported sort")
	}
}

func parseSortDirection(raw string) (string, error) {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "", "desc":
		return "desc", nil
	case "asc":
		return "asc", nil
	default:
		return "", fmt.Errorf("unsupported direction")
	}
}

func parseActivityCursor(cursor string) (*string, *string, error) {
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
	return &parts[0], &parts[1], nil
}

func activityCursorValue(note models.Note, sortBy string) string {
	switch sortBy {
	case "created":
		return note.CreatedAt.UTC().Format(time.RFC3339Nano)
	case "title":
		return strings.ToLower(note.Title)
	default:
		return note.UpdatedAt.UTC().Format(time.RFC3339Nano)
	}
}

func noteToActivityItem(note models.Note) DashboardActivityItem {
	noteID := note.ID
	return DashboardActivityItem{
		ID:         fmt.Sprintf("note:%s", note.ID),
		Title:      note.Title,
		ActorLabel: "Me",
		Timestamp:  note.UpdatedAt,
		NoteID:     &noteID,
		FolderID:   note.FolderID,
		CreatedAt:  note.CreatedAt,
		UpdatedAt:  note.UpdatedAt,
	}
}
