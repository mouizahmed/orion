package handlers

import (
	"context"
	"encoding/base64"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/mouizahmed/justscribe-backend/internal/ai"
	"github.com/mouizahmed/justscribe-backend/internal/models"
	"github.com/mouizahmed/justscribe-backend/internal/queue"
	"github.com/mouizahmed/justscribe-backend/internal/repository"
	"github.com/mouizahmed/justscribe-backend/internal/resourceevents"
	"github.com/mouizahmed/justscribe-backend/internal/storage"
)

func backendBaseURL() string {
	base := os.Getenv("BASE_URL")
	if base == "" {
		base = "http://localhost:8080"
	}
	return strings.TrimRight(base, "/")
}

type NotesHandler struct {
	noteRepo         *repository.NoteRepository
	noteVersionRepo  *repository.NoteVersionRepository
	folderRepo       *repository.FolderRepository
	recordingRepo    *repository.RecordingSessionRepository
	b2Client         *storage.B2Client
	attachmentRepo   *repository.NoteAttachmentRepository
	noteAttendeeRepo *repository.NoteAttendeeRepository
	aiClient         *ai.Client
	queue            *queue.Queue
	events           resourceevents.Publisher
}

type CreateNoteRequest struct {
	Title           *string `json:"title"`
	FolderID        *string `json:"folder_id"`
	NoteMarkdown    *string `json:"note_markdown"`
	CalendarEventID *string `json:"calendar_event_id"`
}

type UpdateNoteRequest struct {
	Title            *string `json:"title"`
	FolderID         *string `json:"folder_id"`
	NoteMarkdown     *string `json:"note_markdown"`
	CalendarEventID  *string `json:"calendar_event_id"`
	ExpectedRevision *int64  `json:"expected_revision"`
}

type StopRecordingRequest struct {
	FinalTranscript *string `json:"final_transcript"`
}

type SearchResponse struct {
	Query      string          `json:"query"`
	Notes      []models.Note   `json:"notes"`
	Folders    []models.Folder `json:"folders"`
	Pagination SearchPageMeta  `json:"pagination"`
}

type SearchPageMeta struct {
	Limit   int               `json:"limit"`
	Notes   SearchSectionMeta `json:"notes"`
	Folders SearchSectionMeta `json:"folders"`
}

type SearchSectionMeta struct {
	Offset     int  `json:"offset"`
	NextOffset int  `json:"next_offset"`
	HasMore    bool `json:"has_more"`
}

func NewNotesHandler(noteRepo *repository.NoteRepository, noteVersionRepo *repository.NoteVersionRepository, folderRepo *repository.FolderRepository, recordingRepo *repository.RecordingSessionRepository, b2Client *storage.B2Client, attachmentRepo *repository.NoteAttachmentRepository, noteAttendeeRepo *repository.NoteAttendeeRepository, aiClient *ai.Client, q *queue.Queue, events resourceevents.Publisher) *NotesHandler {
	return &NotesHandler{
		noteRepo:         noteRepo,
		noteVersionRepo:  noteVersionRepo,
		folderRepo:       folderRepo,
		recordingRepo:    recordingRepo,
		b2Client:         b2Client,
		attachmentRepo:   attachmentRepo,
		noteAttendeeRepo: noteAttendeeRepo,
		aiClient:         aiClient,
		queue:            q,
		events:           events,
	}
}

type EnhanceNoteRequest struct {
	ExpectedRevision *int64 `json:"expected_revision"`
}

type RevertNoteRequest struct {
	ExpectedRevision *int64 `json:"expected_revision"`
}

// EnhanceNote saves a version of the current note, then overwrites note_markdown with the enhanced result.
func (h *NotesHandler) EnhanceNote(c *gin.Context) {
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

	var req EnhanceNoteRequest
	if err := c.ShouldBindJSON(&req); err != nil && err != io.EOF {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
		return
	}

	note, err := h.noteRepo.GetNoteByID(userID, noteID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "note not found"})
		return
	}
	if req.ExpectedRevision != nil && note.Revision != *req.ExpectedRevision {
		c.JSON(http.StatusConflict, gin.H{"error": "note has changed", "code": "revision_conflict"})
		return
	}

	if strings.TrimSpace(note.NoteMarkdown) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "note has no content to enhance"})
		return
	}

	// Save current content as a version before enhancing
	version, err := h.noteVersionRepo.CreateVersion(noteID, note.NoteMarkdown)
	if err != nil {
		log.Printf("notes: failed to save version before enhance for note %s: %v", noteID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save version"})
		return
	}

	systemPrompt := `You are an expert note enhancer. Given raw meeting notes or rough notes, produce a clean, well-structured markdown document that:
- Organizes content with clear headings and sections
- Fixes grammar and spelling
- Preserves all important information and details
- Uses bullet points and numbered lists where appropriate
- Highlights key decisions, action items, and important points
- Adds a brief summary at the top if the content is substantial
- Maintains the original meaning and tone

Output only the enhanced markdown, no preamble or explanation.`

	userContent := fmt.Sprintf("Title: %s\n\nNotes:\n%s", note.Title, note.NoteMarkdown)

	enhanced, err := h.aiClient.Generate(c.Request.Context(), systemPrompt, userContent)
	if err != nil {
		log.Printf("notes: failed to enhance note %s: %v", noteID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to enhance note"})
		return
	}

	// Overwrite note_markdown with enhanced content
	note.NoteMarkdown = enhanced
	updated, err := h.noteRepo.UpdateNoteWithRevision(note, req.ExpectedRevision)
	if err != nil {
		if req.ExpectedRevision != nil && strings.Contains(err.Error(), "note not found") {
			if _, readErr := h.noteRepo.GetNoteByID(userID, noteID); readErr == nil {
				c.JSON(http.StatusConflict, gin.H{"error": "note has changed", "code": "revision_conflict"})
				return
			}
			c.JSON(http.StatusNotFound, gin.H{"error": "note not found"})
			return
		}
		log.Printf("notes: failed to update note %s after enhance: %v", noteID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save enhanced note"})
		return
	}
	resourceevents.PublishBestEffort(c.Request.Context(), h.events, userID, resourceevents.ResourceNotes, &noteID)

	c.JSON(http.StatusOK, gin.H{"note": updated, "version_id": version.ID})
}

// ListVersions returns the version history for a note.
func (h *NotesHandler) ListVersions(c *gin.Context) {
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

	// Verify note belongs to user
	if _, err := h.noteRepo.GetNoteByID(userID, noteID); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "note not found"})
		return
	}

	versions, err := h.noteVersionRepo.ListVersions(noteID)
	if err != nil {
		log.Printf("notes: failed to list versions for note %s: %v", noteID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list versions"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"versions": versions})
}

// RevertToVersion restores a note to a previous version's content.
func (h *NotesHandler) RevertToVersion(c *gin.Context) {
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

	versionID := strings.TrimSpace(c.Param("versionID"))
	if versionID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "version id is required"})
		return
	}

	var req RevertNoteRequest
	if err := c.ShouldBindJSON(&req); err != nil && err != io.EOF {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
		return
	}

	note, err := h.noteRepo.GetNoteByID(userID, noteID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "note not found"})
		return
	}
	if req.ExpectedRevision != nil && note.Revision != *req.ExpectedRevision {
		c.JSON(http.StatusConflict, gin.H{"error": "note has changed", "code": "revision_conflict"})
		return
	}

	version, err := h.noteVersionRepo.GetVersion(versionID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "version not found"})
		return
	}

	if version.NoteID != noteID {
		c.JSON(http.StatusBadRequest, gin.H{"error": "version does not belong to this note"})
		return
	}

	// Save current content as a version before reverting
	if _, err := h.noteVersionRepo.CreateVersion(noteID, note.NoteMarkdown); err != nil {
		log.Printf("notes: failed to save version before revert for note %s: %v", noteID, err)
	}

	note.NoteMarkdown = version.NoteMarkdown
	updated, err := h.noteRepo.UpdateNoteWithRevision(note, req.ExpectedRevision)
	if err != nil {
		if req.ExpectedRevision != nil && strings.Contains(err.Error(), "note not found") {
			if _, readErr := h.noteRepo.GetNoteByID(userID, noteID); readErr == nil {
				c.JSON(http.StatusConflict, gin.H{"error": "note has changed", "code": "revision_conflict"})
				return
			}
			c.JSON(http.StatusNotFound, gin.H{"error": "note not found"})
			return
		}
		log.Printf("notes: failed to revert note %s to version %s: %v", noteID, versionID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to revert note"})
		return
	}
	resourceevents.PublishBestEffort(c.Request.Context(), h.events, userID, resourceevents.ResourceNotes, &noteID)

	c.JSON(http.StatusOK, gin.H{"note": updated})
}

func (h *NotesHandler) ListNotes(c *gin.Context) {
	userID, err := getUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
		return
	}

	limitParam := strings.TrimSpace(c.DefaultQuery("limit", "20"))
	limit, err := strconv.Atoi(limitParam)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid limit parameter"})
		return
	}
	if limit > 100 {
		limit = 100
	}
	if limit <= 0 {
		limit = 20
	}

	folderID := strings.TrimSpace(c.Query("folder_id"))
	unfiledParam := strings.TrimSpace(c.Query("unfiled"))
	unfiled := unfiledParam == "true" || unfiledParam == "1"
	if unfiled && folderID != "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "cannot combine folder_id with unfiled"})
		return
	}
	var folderFilter *string
	if folderID != "" {
		if ok, err := h.folderRepo.ExistsForUser(folderID, userID); err != nil {
			log.Printf("notes: failed to validate folder %s: %v", folderID, err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load notes"})
			return
		} else if !ok {
			c.JSON(http.StatusNotFound, gin.H{"error": "folder not found"})
			return
		}
		folderFilter = &folderID
	}

	cursor := strings.TrimSpace(c.Query("cursor"))
	var cursorTime *time.Time
	var cursorID *string
	if cursor != "" {
		decoded, err := base64.RawURLEncoding.DecodeString(cursor)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid cursor"})
			return
		}
		parts := strings.SplitN(string(decoded), "|", 2)
		if len(parts) != 2 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid cursor"})
			return
		}
		parsed, err := time.Parse(time.RFC3339Nano, parts[0])
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid cursor"})
			return
		}
		cursorTime = &parsed
		cursorID = &parts[1]
	}

	fetchLimit := limit + 1
	notes, err := h.noteRepo.ListNotesByUserCursor(userID, folderFilter, unfiled, fetchLimit, cursorTime, cursorID)
	if err != nil {
		log.Printf("notes: failed to list notes for user %s: %v", userID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load notes"})
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

	c.JSON(http.StatusOK, gin.H{
		"notes": notes,
		"pagination": gin.H{
			"limit":       limit,
			"has_more":    hasMore,
			"next_cursor": nextCursor,
		},
	})
}

func (h *NotesHandler) Search(c *gin.Context) {
	userID, err := getUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
		return
	}

	query := strings.TrimSpace(c.Query("q"))
	if query == "" {
		c.JSON(http.StatusOK, SearchResponse{
			Query:   "",
			Notes:   []models.Note{},
			Folders: []models.Folder{},
			Pagination: SearchPageMeta{
				Limit:   limitDefault(),
				Notes:   SearchSectionMeta{Offset: 0, NextOffset: 0, HasMore: false},
				Folders: SearchSectionMeta{Offset: 0, NextOffset: 0, HasMore: false},
			},
		})
		return
	}

	limit := limitDefault()
	if raw := strings.TrimSpace(c.Query("limit")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid limit parameter"})
			return
		}
		limit = parsed
	}
	if limit <= 0 {
		limit = 10
	}
	if limit > 100 {
		limit = 100
	}
	noteLimit := limit
	if raw := strings.TrimSpace(c.Query("note_limit")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 0 || parsed > 100 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid note_limit parameter"})
			return
		}
		noteLimit = parsed
	}
	folderLimit := limit
	if raw := strings.TrimSpace(c.Query("folder_limit")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 0 || parsed > 100 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid folder_limit parameter"})
			return
		}
		folderLimit = parsed
	}

	noteOffset := 0
	if raw := strings.TrimSpace(c.Query("note_offset")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid note_offset parameter"})
			return
		}
		noteOffset = parsed
	}

	folderOffset := 0
	if raw := strings.TrimSpace(c.Query("folder_offset")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid folder_offset parameter"})
			return
		}
		folderOffset = parsed
	}

	notes := []models.Note{}
	notesHasMore := false
	if noteLimit > 0 {
		notesWithExtra, err := h.noteRepo.SearchNotes(userID, query, nil, noteLimit+1, noteOffset)
		if err != nil {
			log.Printf("search: failed to search notes for user %s: %v", userID, err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to run search"})
			return
		}
		notesHasMore = len(notesWithExtra) > noteLimit
		notes = notesWithExtra
		if notesHasMore {
			notes = notesWithExtra[:noteLimit]
		}
	}

	folders := []models.Folder{}
	foldersHasMore := false
	if folderLimit > 0 {
		foldersWithExtra, err := h.folderRepo.SearchFolders(userID, query, folderLimit+1, folderOffset)
		if err != nil {
			log.Printf("search: failed to search folders for user %s: %v", userID, err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to run search"})
			return
		}
		foldersHasMore = len(foldersWithExtra) > folderLimit
		folders = foldersWithExtra
		if foldersHasMore {
			folders = foldersWithExtra[:folderLimit]
		}
	}

	c.JSON(http.StatusOK, SearchResponse{
		Query:   query,
		Notes:   notes,
		Folders: folders,
		Pagination: SearchPageMeta{
			Limit: limit,
			Notes: SearchSectionMeta{
				Offset: noteOffset, NextOffset: noteOffset + len(notes), HasMore: notesHasMore,
			},
			Folders: SearchSectionMeta{
				Offset: folderOffset, NextOffset: folderOffset + len(folders), HasMore: foldersHasMore,
			},
		},
	})
}

func limitDefault() int {
	return 10
}

func (h *NotesHandler) GetNote(c *gin.Context) {
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

	note, err := h.noteRepo.GetNoteDetailByID(userID, noteID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "note not found"})
		return
	}

	attendees, err := h.noteAttendeeRepo.ListByNote(noteID)
	if err != nil {
		log.Printf("notes: failed to fetch attendees for note %s: %v", noteID, err)
		attendees = []models.NoteAttendee{}
	}
	note.Attendees = attendees

	c.JSON(http.StatusOK, gin.H{"note": note})
}

func (h *NotesHandler) CreateNote(c *gin.Context) {
	userID, err := getUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
		return
	}

	var req CreateNoteRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request payload"})
		return
	}

	title := "Untitled note"
	if req.Title != nil {
		if trimmed := strings.TrimSpace(*req.Title); trimmed != "" {
			title = trimmed
		}
	}

	note := &models.Note{
		UserID:          userID,
		FolderID:        req.FolderID,
		Title:           title,
		NoteMarkdown:    derefString(req.NoteMarkdown),
		CalendarEventID: req.CalendarEventID,
	}

	if req.FolderID != nil && strings.TrimSpace(*req.FolderID) != "" {
		if ok, err := h.folderRepo.ExistsForUser(*req.FolderID, userID); err != nil {
			log.Printf("notes: failed to validate folder %s: %v", *req.FolderID, err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create note"})
			return
		} else if !ok {
			c.JSON(http.StatusBadRequest, gin.H{"error": "folder not found"})
			return
		}
	}

	// If this note is linked to a calendar event, return the existing note rather than
	// creating a duplicate (one note per event per user).
	if note.CalendarEventID != nil {
		existing, err := h.noteRepo.ListNotesByEvent(userID, *note.CalendarEventID, 1, nil, nil)
		if err == nil && len(existing) > 0 {
			c.JSON(http.StatusOK, gin.H{"note": existing[0]})
			return
		}
	}

	created, err := h.noteRepo.CreateNote(note)
	if err != nil {
		log.Printf("notes: failed to create note for user %s: %v", userID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create note"})
		return
	}
	if err := h.noteAttendeeRepo.AddByUserID(created.ID, userID); err != nil {
		log.Printf("notes: failed to add creator attendee for note %s: %v", created.ID, err)
	}
	if created.CalendarEventID != nil {
		if err := h.noteAttendeeRepo.SyncNoteFromEvent(created.ID, *created.CalendarEventID); err != nil {
			log.Printf("notes: failed to sync attendees from calendar event for note %s: %v", created.ID, err)
		}
	}
	resourceevents.PublishBestEffort(c.Request.Context(), h.events, userID, resourceevents.ResourceNotes, &created.ID)

	c.JSON(http.StatusOK, gin.H{"note": created})
}

func (h *NotesHandler) UpdateNote(c *gin.Context) {
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

	var req UpdateNoteRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request payload"})
		return
	}

	if req.Title == nil && req.FolderID == nil && req.NoteMarkdown == nil && req.CalendarEventID == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "no fields to update"})
		return
	}

	existing, err := h.noteRepo.GetNoteByID(userID, noteID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "note not found"})
		return
	}

	if req.Title != nil {
		if trimmed := strings.TrimSpace(*req.Title); trimmed != "" {
			existing.Title = trimmed
		}
	}
	if req.FolderID != nil {
		if strings.TrimSpace(*req.FolderID) == "" {
			existing.FolderID = nil
		} else {
			if ok, err := h.folderRepo.ExistsForUser(*req.FolderID, userID); err != nil {
				log.Printf("notes: failed to validate folder %s: %v", *req.FolderID, err)
				c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update note"})
				return
			} else if !ok {
				c.JSON(http.StatusBadRequest, gin.H{"error": "folder not found"})
				return
			}
			existing.FolderID = req.FolderID
		}
	}
	if req.NoteMarkdown != nil {
		existing.NoteMarkdown = *req.NoteMarkdown
	}
	if req.CalendarEventID != nil {
		if *req.CalendarEventID == "" {
			existing.CalendarEventID = nil
		} else {
			existing.CalendarEventID = req.CalendarEventID
		}
	}

	updated, err := h.noteRepo.UpdateNoteWithRevision(existing, req.ExpectedRevision)
	if err != nil {
		if req.ExpectedRevision != nil && strings.Contains(err.Error(), "note not found") {
			if _, readErr := h.noteRepo.GetNoteByID(userID, noteID); readErr == nil {
				c.JSON(http.StatusConflict, gin.H{"error": "note has changed", "code": "revision_conflict"})
				return
			}
			c.JSON(http.StatusNotFound, gin.H{"error": "note not found"})
			return
		}
		if strings.Contains(err.Error(), "notes_one_per_event_idx") {
			c.JSON(http.StatusConflict, gin.H{"error": "Another note is already linked to this event"})
			return
		}
		log.Printf("notes: failed to update note %s: %v", noteID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update note"})
		return
	}
	resourceevents.PublishBestEffort(c.Request.Context(), h.events, userID, resourceevents.ResourceNotes, &noteID)

	if h.queue != nil {
		go func() {
			_ = h.queue.Enqueue(context.Background(), queue.Job{
				Type: queue.JobIndexNote, UserID: userID, ID: noteID,
			})
		}()
	}

	c.JSON(http.StatusOK, gin.H{"note": updated})
}

func (h *NotesHandler) DeleteNote(c *gin.Context) {
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

	deleted, err := h.noteRepo.DeleteNote(userID, noteID)
	if err != nil {
		log.Printf("notes: failed to delete note %s: %v", noteID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete note"})
		return
	}
	if !deleted {
		c.JSON(http.StatusNotFound, gin.H{"error": "note not found"})
		return
	}
	resourceevents.PublishBestEffort(c.Request.Context(), h.events, userID, resourceevents.ResourceNotes, &noteID)

	if h.queue != nil {
		go func() {
			_ = h.queue.Enqueue(context.Background(), queue.Job{
				Type: queue.JobDeleteNote, UserID: userID, ID: noteID,
			})
		}()
	}

	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}

func (h *NotesHandler) StartRecording(c *gin.Context) {
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

	active, err := h.recordingRepo.GetActiveSession(noteID, userID)
	if err != nil {
		log.Printf("recording: failed to check active session: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to start recording"})
		return
	}
	if active != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "recording already active"})
		return
	}

	session, err := h.recordingRepo.CreateSession(noteID, userID)
	if err != nil {
		log.Printf("recording: failed to create session: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to start recording"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"session": session})
}

func (h *NotesHandler) StopRecording(c *gin.Context) {
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

	sessionID := strings.TrimSpace(c.Param("sessionID"))
	if sessionID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "session id is required"})
		return
	}

	var req StopRecordingRequest
	if err := c.ShouldBindJSON(&req); err != nil && err != io.EOF {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request payload"})
		return
	}

	session, err := h.recordingRepo.StopSession(sessionID, noteID, userID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "session not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"session": session,
	})
}

func (h *NotesHandler) GetNotesByEvent(c *gin.Context) {
	userID, err := getUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
		return
	}

	calendarEventID := strings.TrimSpace(c.Query("calendar_event_id"))
	if calendarEventID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "calendar_event_id is required"})
		return
	}

	limitStr := c.DefaultQuery("limit", "20")
	limit, err := strconv.Atoi(limitStr)
	if err != nil || limit < 1 || limit > 50 {
		limit = 20
	}

	cursor := strings.TrimSpace(c.Query("cursor"))
	var cursorTime *time.Time
	var cursorID *string
	if cursor != "" {
		decoded, err := base64.RawURLEncoding.DecodeString(cursor)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid cursor"})
			return
		}
		parts := strings.SplitN(string(decoded), "|", 2)
		if len(parts) != 2 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid cursor"})
			return
		}
		parsed, err := time.Parse(time.RFC3339Nano, parts[0])
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid cursor"})
			return
		}
		cursorTime = &parsed
		cursorID = &parts[1]
	}

	fetchLimit := limit + 1
	notes, err := h.noteRepo.ListNotesByEvent(userID, calendarEventID, fetchLimit, cursorTime, cursorID)
	if err != nil {
		log.Printf("notes: failed to list notes by event for user %s: %v", userID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load notes"})
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
		rawCursor := fmt.Sprintf("%s|%s", last.CreatedAt.UTC().Format(time.RFC3339Nano), last.ID)
		encoded := base64.RawURLEncoding.EncodeToString([]byte(rawCursor))
		nextCursor = &encoded
	}

	c.JSON(http.StatusOK, gin.H{
		"notes": notes,
		"pagination": gin.H{
			"has_more":    hasMore,
			"next_cursor": nextCursor,
		},
	})
}

func derefString(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

var allowedImageTypes = map[string]bool{
	"image/png":  true,
	"image/jpeg": true,
	"image/gif":  true,
	"image/webp": true,
}

const maxImageSize = 10 << 20 // 10 MB

func (h *NotesHandler) UploadImage(c *gin.Context) {
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

	// Verify note exists and belongs to user
	if _, err := h.noteRepo.GetNoteByID(userID, noteID); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "note not found"})
		return
	}

	fileHeader, err := c.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "file is required"})
		return
	}

	if fileHeader.Size > maxImageSize {
		c.JSON(http.StatusBadRequest, gin.H{"error": "file too large (max 10MB)"})
		return
	}

	mimeType := fileHeader.Header.Get("Content-Type")
	if !allowedImageTypes[mimeType] {
		c.JSON(http.StatusBadRequest, gin.H{"error": "unsupported file type; allowed: png, jpeg, gif, webp"})
		return
	}

	file, err := fileHeader.Open()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to read file"})
		return
	}
	defer file.Close()

	data, err := io.ReadAll(file)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to read file"})
		return
	}

	sanitized := sanitizeFileName(fileHeader.Filename)
	b2FileName := fmt.Sprintf("notes/%s/%s/%s-%s", userID, noteID, uuid.NewString(), sanitized)

	uploadURLResp, err := h.b2Client.GetUploadURL()
	if err != nil {
		log.Printf("notes: failed to get B2 upload URL: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to upload image"})
		return
	}

	uploadResp, err := h.b2Client.UploadFile(
		uploadURLResp.UploadURL,
		uploadURLResp.AuthorizationToken,
		b2FileName,
		mimeType,
		data,
	)
	if err != nil {
		log.Printf("notes: failed to upload to B2: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to upload image"})
		return
	}

	publicURL := h.b2Client.GetFileURL(uploadResp.FileName)

	att := &models.NoteAttachment{
		NoteID:     noteID,
		UserID:     userID,
		FileName:   fileHeader.Filename,
		MimeType:   mimeType,
		SizeBytes:  fileHeader.Size,
		B2FileID:   uploadResp.FileID,
		B2FileName: uploadResp.FileName,
		PublicURL:  publicURL,
	}

	created, err := h.attachmentRepo.CreateAttachment(att)
	if err != nil {
		log.Printf("notes: failed to save attachment record: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save attachment"})
		return
	}

	proxyURL := fmt.Sprintf("%s/api/notes/%s/images/%s", backendBaseURL(), noteID, created.ID)
	c.JSON(http.StatusOK, gin.H{"url": proxyURL})
}

func (h *NotesHandler) ProxyImage(c *gin.Context) {
	userID, err := getUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
		return
	}

	noteID := strings.TrimSpace(c.Param("noteID"))
	imageID := strings.TrimSpace(c.Param("imageID"))
	if noteID == "" || imageID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "note id and image id are required"})
		return
	}

	att, err := h.attachmentRepo.GetByID(userID, imageID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "image not found"})
		return
	}

	if att.NoteID != noteID {
		c.JSON(http.StatusNotFound, gin.H{"error": "image not found"})
		return
	}

	signedURL, err := h.b2Client.GetSignedDownloadURL(att.B2FileName, 3600)
	if err != nil {
		log.Printf("notes: failed to generate signed URL for %s: %v", att.B2FileName, err)
		c.JSON(http.StatusBadGateway, gin.H{"error": "failed to retrieve image"})
		return
	}

	c.Redirect(http.StatusFound, signedURL)
}

func (h *NotesHandler) DeleteImage(c *gin.Context) {
	userID, err := getUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
		return
	}

	imageID := strings.TrimSpace(c.Param("imageID"))
	if imageID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "image id is required"})
		return
	}

	att, err := h.attachmentRepo.GetByID(userID, imageID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "image not found"})
		return
	}

	deleted, err := h.attachmentRepo.DeleteAttachment(userID, imageID)
	if err != nil {
		log.Printf("notes: failed to soft-delete attachment %s: %v", imageID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete image"})
		return
	}
	if !deleted {
		c.JSON(http.StatusNotFound, gin.H{"error": "image not found"})
		return
	}

	if err := h.b2Client.DeleteFile(att.B2FileName); err != nil {
		log.Printf("notes: failed to delete B2 file %s: %v", att.B2FileName, err)
		// Don't fail the request — the DB record is already soft-deleted
	}

	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}
