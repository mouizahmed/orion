package ai

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/mouizahmed/justscribe-backend/internal/database"
	"github.com/mouizahmed/justscribe-backend/internal/repository"
	"github.com/mouizahmed/justscribe-backend/internal/retrieval"
)

type ToolExecutor struct {
	noteRepo       *repository.NoteRepository
	transcriptRepo *repository.TranscriptRepository
	folderRepo     *repository.FolderRepository
	db             *database.DB
	retriever      *retrieval.Retriever
}

func NewToolExecutor(noteRepo *repository.NoteRepository, transcriptRepo *repository.TranscriptRepository, folderRepo *repository.FolderRepository, db *database.DB, retriever *retrieval.Retriever) *ToolExecutor {
	return &ToolExecutor{
		noteRepo:       noteRepo,
		transcriptRepo: transcriptRepo,
		folderRepo:     folderRepo,
		db:             db,
		retriever:      retriever,
	}
}

func (t *ToolExecutor) GetToolDefinitions() []ToolDefinition {
	return []ToolDefinition{
		// 1. search_notes
		{
			Name:        "search_notes",
			Description: "Search for notes by keyword in titles and content. Returns matching notes with excerpts.",
			Properties: map[string]interface{}{
				"query": map[string]interface{}{
					"type":        "string",
					"description": "Search keywords",
				},
				"folder_id": map[string]interface{}{
					"type":        "string",
					"description": "Optional folder ID to filter results",
				},
				"limit": map[string]interface{}{
					"type":        "integer",
					"description": "Maximum number of results (default 10)",
				},
			},
			Required: []string{"query"},
		},
		// 2. get_note
		{
			Name:        "get_note",
			Description: "Get the full markdown content of a note by ID or title. Prefer using the note's UUID when available (e.g. from the active note context).",
			Properties: map[string]interface{}{
				"identifier": map[string]interface{}{
					"type":        "string",
					"description": "Exact note UUID, or a title to fuzzy-match",
				},
			},
			Required: []string{"identifier"},
		},
		// 3. list_notes
		{
			Name:        "list_notes",
			Description: "List notes with optional filters and sorting.",
			Properties: map[string]interface{}{
				"folder_id": map[string]interface{}{
					"type":        "string",
					"description": "Filter by folder ID",
				},
				"limit": map[string]interface{}{
					"type":        "integer",
					"description": "Maximum results (default 20)",
				},
				"sort": map[string]interface{}{
					"type":        "string",
					"description": "Sort by: created_at, updated_at, title (default: updated_at)",
				},
			},
			Required: []string{},
		},
		// 4. get_note_stats
		{
			Name:        "get_note_stats",
			Description: "Get statistics about the user's notes (total count, notes per folder, etc.)",
			Properties:  map[string]interface{}{},
			Required:    []string{},
		},
		// 5. get_transcript
		{
			Name:        "get_transcript",
			Description: "Get the full transcript for a specific note.",
			Properties: map[string]interface{}{
				"note_id": map[string]interface{}{
					"type":        "string",
					"description": "Note UUID",
				},
			},
			Required: []string{"note_id"},
		},
		// 7. list_folders
		{
			Name:        "list_folders",
			Description: "Get all folders with note counts.",
			Properties:  map[string]interface{}{},
			Required:    []string{},
		},
		// 8. get_folder_contents
		{
			Name:        "get_folder_contents",
			Description: "Get all notes in a specific folder.",
			Properties: map[string]interface{}{
				"folder_id": map[string]interface{}{
					"type":        "string",
					"description": "Folder UUID",
				},
			},
			Required: []string{"folder_id"},
		},
		// 9. get_notes_by_date
		{
			Name:        "get_notes_by_date",
			Description: "Find notes created in a date range.",
			Properties: map[string]interface{}{
				"start_date": map[string]interface{}{
					"type":        "string",
					"description": "Start date (YYYY-MM-DD)",
				},
				"end_date": map[string]interface{}{
					"type":        "string",
					"description": "End date (YYYY-MM-DD), optional",
				},
			},
			Required: []string{"start_date"},
		},
		// 10. semantic_search
		{
			Name:        "semantic_search",
			Description: "Search notes and transcripts by meaning/concept (not just keywords). Use when the user asks conceptual questions or references ideas rather than exact phrases.",
			Properties: map[string]interface{}{
				"query": map[string]interface{}{
					"type":        "string",
					"description": "Natural language search query",
				},
				"note_id": map[string]interface{}{
					"type":        "string",
					"description": "Optional: limit search to a specific note",
				},
			},
			Required: []string{"query"},
		},
		// 12. edit_note
		{
			Name:        "edit_note",
			Description: "Replace the markdown content of the currently active note. Call get_note first to read the current content, apply your changes, then pass the complete updated document. Never pass only the changed portion — always pass the full note. Can only edit the active note — if the user wants to edit a different note, tell them to open it first.",
			Properties: map[string]interface{}{
				"content": map[string]interface{}{
					"type":        "string",
					"description": "The complete updated markdown content of the note",
				},
			},
			Required: []string{"content"},
		},
	}
}

func (t *ToolExecutor) GetReadOnlyToolDefinitions() []ToolDefinition {
	all := t.GetToolDefinitions()
	out := make([]ToolDefinition, 0, len(all)-1)
	for _, td := range all {
		if td.Name != "edit_note" {
			out = append(out, td)
		}
	}
	return out
}

func (t *ToolExecutor) Execute(ctx context.Context, userID, activeNoteID, toolName string, input json.RawMessage) (string, error) {
	switch toolName {
	case "search_notes":
		return t.searchNotes(userID, input)
	case "get_note":
		return t.getNote(userID, input)
	case "list_notes":
		return t.listNotes(userID, input)
	case "get_note_stats":
		return t.getNoteStats(userID, input)
	case "get_transcript":
		return t.getTranscript(userID, input)
	case "list_folders":
		return t.listFolders(userID, input)
	case "get_folder_contents":
		return t.getFolderContents(userID, input)
	case "get_notes_by_date":
		return t.getNotesByDate(userID, input)
	case "semantic_search":
		return t.semanticSearch(ctx, userID, input)
	case "edit_note":
		return t.editNote(userID, activeNoteID, input)
	default:
		return "", fmt.Errorf("unknown tool: %s", toolName)
	}
}

// 1. search_notes - Search for notes by keyword
func (t *ToolExecutor) searchNotes(userID string, input json.RawMessage) (string, error) {
	var params struct {
		Query    string `json:"query"`
		FolderID string `json:"folder_id"`
		Limit    int    `json:"limit"`
	}
	if err := json.Unmarshal(input, &params); err != nil {
		return "", fmt.Errorf("invalid input: %w", err)
	}

	if params.Limit == 0 {
		params.Limit = 10
	}

	var folderID *string
	if params.FolderID != "" {
		folderID = &params.FolderID
	}

	notes, err := t.noteRepo.SearchNotes(userID, params.Query, folderID, params.Limit, 0)
	if err != nil {
		return "", fmt.Errorf("search failed: %w", err)
	}

	if len(notes) == 0 {
		return "No notes found matching your search.", nil
	}

	var result strings.Builder
	result.WriteString(fmt.Sprintf("Found %d note(s):\n\n", len(notes)))
	for _, note := range notes {
		result.WriteString(fmt.Sprintf("**%s** (id: %s)\n", note.Title, note.ID))
		result.WriteString(fmt.Sprintf("Created: %s\n", note.CreatedAt.Format("Jan 2, 2006")))
		excerpt := note.NoteMarkdown
		if len(excerpt) > 200 {
			excerpt = excerpt[:200] + "..."
		}
		if excerpt != "" {
			result.WriteString(fmt.Sprintf("Excerpt: %s\n", excerpt))
		}
		result.WriteString("\n")
	}
	return result.String(), nil
}

// 2. get_note - Get full note content by title or ID
func (t *ToolExecutor) getNote(userID string, input json.RawMessage) (string, error) {
	var params struct {
		Identifier string `json:"identifier"`
	}
	if err := json.Unmarshal(input, &params); err != nil {
		return "", fmt.Errorf("invalid input: %w", err)
	}

	// Try exact ID match first
	note, err := t.noteRepo.GetNoteByID(userID, params.Identifier)
	if err != nil {
		// Try fuzzy title search
		notes, searchErr := t.noteRepo.SearchNotes(userID, params.Identifier, nil, 1, 0)
		if searchErr != nil || len(notes) == 0 {
			return "Note not found.", nil
		}
		note = &notes[0]
	}

	var result strings.Builder
	result.WriteString(fmt.Sprintf("Note: %s (ID: %s)\n\n", note.Title, note.ID))
	if note.NoteMarkdown != "" {
		result.WriteString("Content:\n")
		result.WriteString(note.NoteMarkdown)
	} else {
		result.WriteString("This note has no written content.")
	}

	// Indicate if a transcript is available so the AI can fetch it when needed
	segments, err := t.transcriptRepo.GetSegmentsByNote(note.ID, userID)
	if err == nil && len(segments) > 0 {
		result.WriteString(fmt.Sprintf("\n\n[This note has a meeting transcript (%d segments). Call get_transcript with this note's ID to retrieve it.]", len(segments)))
	}

	return result.String(), nil
}

// 3. list_notes - List notes with filters and sorting
func (t *ToolExecutor) listNotes(userID string, input json.RawMessage) (string, error) {
	var params struct {
		FolderID string `json:"folder_id"`
		Limit    int    `json:"limit"`
		Sort     string `json:"sort"`
	}
	if err := json.Unmarshal(input, &params); err != nil {
		return "", fmt.Errorf("invalid input: %w", err)
	}

	if params.Limit == 0 {
		params.Limit = 20
	}

	var folderID *string
	if params.FolderID != "" {
		folderID = &params.FolderID
	}
	notes, err := t.noteRepo.ListNotesByUserCursor(userID, folderID, false, params.Limit, nil, nil)
	if err != nil {
		return "", fmt.Errorf("list failed: %w", err)
	}

	if len(notes) == 0 {
		return "No notes found.", nil
	}

	// Apply sort
	switch params.Sort {
	case "title":
		sort.Slice(notes, func(i, j int) bool {
			return notes[i].Title < notes[j].Title
		})
	case "created_at":
		sort.Slice(notes, func(i, j int) bool {
			return notes[i].CreatedAt.After(notes[j].CreatedAt)
		})
		// default: already sorted by updated_at DESC from repo
	}

	var result strings.Builder
	result.WriteString(fmt.Sprintf("Found %d note(s):\n\n", len(notes)))
	for _, note := range notes {
		result.WriteString(fmt.Sprintf("- **%s** (id: %s, %s)\n", note.Title, note.ID, note.CreatedAt.Format("Jan 2, 2006")))
	}
	return result.String(), nil
}

// 4. get_note_stats - Get statistics using SQL COUNT
func (t *ToolExecutor) getNoteStats(userID string, input json.RawMessage) (string, error) {
	folderCounts, total, err := t.noteRepo.CountNotesByFolderGrouped(userID)
	if err != nil {
		return "", fmt.Errorf("stats failed: %w", err)
	}

	var result strings.Builder
	result.WriteString(fmt.Sprintf("Total notes: %d\n\n", total))

	if len(folderCounts) > 0 {
		result.WriteString("Notes by folder:\n")
		for _, fc := range folderCounts {
			result.WriteString(fmt.Sprintf("- %s: %d\n", fc.Name, fc.Count))
		}
	}

	return result.String(), nil
}

// 5. get_transcript - Get full transcript for a note
func (t *ToolExecutor) getTranscript(userID string, input json.RawMessage) (string, error) {
	var params struct {
		NoteID string `json:"note_id"`
	}
	if err := json.Unmarshal(input, &params); err != nil {
		return "", fmt.Errorf("invalid input: %w", err)
	}

	segments, err := t.transcriptRepo.GetSegmentsByNote(params.NoteID, userID)
	if err != nil {
		return "Transcript not found.", nil
	}

	if len(segments) == 0 {
		return "No transcript found for this note.", nil
	}

	var result strings.Builder
	result.WriteString(fmt.Sprintf("Transcript (%d segments):\n\n", len(segments)))
	for _, seg := range segments {
		source := "System audio"
		if seg.Channel == 0 {
			source = "You"
		}
		result.WriteString(fmt.Sprintf("[%s]: %s\n", source, seg.Text))
	}

	return result.String(), nil
}

// 7. list_folders - List all folders
func (t *ToolExecutor) listFolders(userID string, input json.RawMessage) (string, error) {
	folders, err := t.folderRepo.ListFolders(userID)
	if err != nil {
		return "", fmt.Errorf("list failed: %w", err)
	}

	if len(folders) == 0 {
		return "No folders found.", nil
	}

	var result strings.Builder
	result.WriteString(fmt.Sprintf("Found %d folder(s):\n\n", len(folders)))
	for _, folder := range folders {
		result.WriteString(fmt.Sprintf("- **%s** (ID: %s)\n", folder.Name, folder.ID))
	}
	return result.String(), nil
}

// 8. get_folder_contents - Get notes in a folder
func (t *ToolExecutor) getFolderContents(userID string, input json.RawMessage) (string, error) {
	var params struct {
		FolderID string `json:"folder_id"`
	}
	if err := json.Unmarshal(input, &params); err != nil {
		return "", fmt.Errorf("invalid input: %w", err)
	}

	folderID := params.FolderID
	notes, err := t.noteRepo.ListNotesByUserCursor(userID, &folderID, false, 100, nil, nil)
	if err != nil {
		return "", fmt.Errorf("list failed: %w", err)
	}

	if len(notes) == 0 {
		return "No notes found in this folder.", nil
	}

	var result strings.Builder
	result.WriteString(fmt.Sprintf("Found %d note(s) in folder:\n\n", len(notes)))
	for _, note := range notes {
		result.WriteString(fmt.Sprintf("- **%s** (id: %s, %s)\n", note.Title, note.ID, note.CreatedAt.Format("Jan 2, 2006")))
	}
	return result.String(), nil
}

// 9. get_notes_by_date - Find notes in date range using SQL
func (t *ToolExecutor) getNotesByDate(userID string, input json.RawMessage) (string, error) {
	var params struct {
		StartDate string `json:"start_date"`
		EndDate   string `json:"end_date"`
	}
	if err := json.Unmarshal(input, &params); err != nil {
		return "", fmt.Errorf("invalid input: %w", err)
	}

	startTime, err := time.Parse("2006-01-02", params.StartDate)
	if err != nil {
		return "Invalid start date format. Use YYYY-MM-DD.", nil
	}

	endTime := time.Now()
	if params.EndDate != "" {
		endTime, err = time.Parse("2006-01-02", params.EndDate)
		if err != nil {
			return "Invalid end date format. Use YYYY-MM-DD.", nil
		}
	}
	// Add a day to make end date inclusive
	endTime = endTime.Add(24 * time.Hour)

	notes, err := t.noteRepo.ListNotesByDateRange(userID, startTime, endTime, 50)
	if err != nil {
		return "", fmt.Errorf("query failed: %w", err)
	}

	if len(notes) == 0 {
		return "No notes found in this date range.", nil
	}

	var result strings.Builder
	result.WriteString(fmt.Sprintf("Found %d note(s) between %s and %s:\n\n",
		len(notes), startTime.Format("Jan 2, 2006"), endTime.Add(-24*time.Hour).Format("Jan 2, 2006")))

	for _, note := range notes {
		result.WriteString(fmt.Sprintf("- **%s** (id: %s, %s)\n", note.Title, note.ID, note.CreatedAt.Format("Jan 2, 2006")))
	}
	return result.String(), nil
}

// 10. get_recent_notes - Get most recent notes
func (t *ToolExecutor) getRecentNotes(userID string, input json.RawMessage) (string, error) {
	var params struct {
		Limit int `json:"limit"`
	}
	if err := json.Unmarshal(input, &params); err != nil {
		return "", fmt.Errorf("invalid input: %w", err)
	}

	if params.Limit == 0 {
		params.Limit = 10
	}

	notes, err := t.noteRepo.ListNotesByUserCursor(userID, nil, false, params.Limit, nil, nil)
	if err != nil {
		return "", fmt.Errorf("list failed: %w", err)
	}

	if len(notes) == 0 {
		return "No notes found.", nil
	}

	var result strings.Builder
	result.WriteString(fmt.Sprintf("Your %d most recent note(s):\n\n", len(notes)))
	for _, note := range notes {
		result.WriteString(fmt.Sprintf("- **%s** (id: %s, %s)\n", note.Title, note.ID, note.CreatedAt.Format("Jan 2, 2006 3:04 PM")))
	}
	return result.String(), nil
}

// 12. edit_note - Replace content of the active note
func (t *ToolExecutor) editNote(userID, activeNoteID string, input json.RawMessage) (string, error) {
	if activeNoteID == "" {
		return "No note is currently open. Ask the user to open a note first.", nil
	}

	var params struct {
		Content string `json:"content"`
	}
	if err := json.Unmarshal(input, &params); err != nil {
		return "", fmt.Errorf("invalid input: %w", err)
	}

	note, err := t.noteRepo.GetNoteByID(userID, activeNoteID)
	if err != nil {
		return "Note not found.", nil
	}

	note.NoteMarkdown = params.Content
	_, err = t.noteRepo.UpdateNote(note)
	if err != nil {
		return "", fmt.Errorf("update failed: %w", err)
	}

	return fmt.Sprintf("Note \"%s\" updated successfully.", note.Title), nil
}

// 11. semantic_search - Search by meaning/concept
func (t *ToolExecutor) semanticSearch(ctx context.Context, userID string, input json.RawMessage) (string, error) {
	var params struct {
		Query  string `json:"query"`
		NoteID string `json:"note_id"`
	}
	if err := json.Unmarshal(input, &params); err != nil {
		return "", fmt.Errorf("invalid input: %w", err)
	}

	if t.retriever == nil {
		return "Semantic search is not available.", nil
	}

	scope := retrieval.Scope{NoteID: params.NoteID}
	result, err := t.retriever.RetrieveContext(ctx, userID, params.Query, scope, 8)
	if err != nil {
		return "", fmt.Errorf("semantic search failed: %w", err)
	}

	if result == "" {
		return "No relevant content found.", nil
	}

	return result, nil
}
