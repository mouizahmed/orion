package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/mouizahmed/justscribe-backend/internal/ai"
	"github.com/mouizahmed/justscribe-backend/internal/models"
	"github.com/mouizahmed/justscribe-backend/internal/prompts"
	"github.com/mouizahmed/justscribe-backend/internal/queue"
	"github.com/mouizahmed/justscribe-backend/internal/repository"
	"github.com/mouizahmed/justscribe-backend/internal/retrieval"
)

type ChatHandler struct {
	convRepo     *repository.ConversationRepository
	msgRepo      *repository.MessageRepository
	aiClient     *ai.Client
	toolExecutor *ai.ToolExecutor
	retriever    *retrieval.Retriever
	queue        *queue.Queue
}

func NewChatHandler(
	convRepo *repository.ConversationRepository,
	msgRepo *repository.MessageRepository,
	aiClient *ai.Client,
	toolExecutor *ai.ToolExecutor,
	retriever *retrieval.Retriever,
	q *queue.Queue,
) *ChatHandler {
	return &ChatHandler{
		convRepo:     convRepo,
		msgRepo:      msgRepo,
		aiClient:     aiClient,
		toolExecutor: toolExecutor,
		retriever:    retriever,
		queue:        q,
	}
}

type CreateConversationRequest struct {
	Title    string  `json:"title"`
	NoteID   *string `json:"note_id,omitempty"`
	FolderID *string `json:"folder_id,omitempty"`
}

type SendMessageRequest struct {
	Content string `json:"content"`
}

func (h *ChatHandler) CreateConversation(c *gin.Context) {
	userID, err := getUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
		return
	}

	var req CreateConversationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		req.Title = "New conversation"
	}
	if strings.TrimSpace(req.Title) == "" {
		req.Title = "New conversation"
	}

	conv, err := h.convRepo.Create(&models.Conversation{
		UserID:   userID,
		Title:    req.Title,
		NoteID:   nilIfEmpty(req.NoteID),
		FolderID: nilIfEmpty(req.FolderID),
	})
	if err != nil {
		log.Printf("chat: failed to create conversation: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create conversation"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"conversation": conv})
}

func (h *ChatHandler) ListConversations(c *gin.Context) {
	userID, err := getUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
		return
	}

	noteID := nilIfEmptyStr(c.Query("note_id"))
	folderID := nilIfEmptyStr(c.Query("folder_id"))
	conversations, err := h.convRepo.ListByScope(userID, noteID, folderID, 50)
	if err != nil {
		log.Printf("chat: failed to list conversations: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list conversations"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"conversations": conversations})
}

func (h *ChatHandler) DeleteConversation(c *gin.Context) {
	userID, err := getUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
		return
	}

	convID := strings.TrimSpace(c.Param("conversationID"))
	if convID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "conversation id is required"})
		return
	}

	deleted, err := h.convRepo.Delete(userID, convID)
	if err != nil {
		log.Printf("chat: failed to delete conversation %s: %v", convID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete conversation"})
		return
	}
	if !deleted {
		c.JSON(http.StatusNotFound, gin.H{"error": "conversation not found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}

type RenameConversationRequest struct {
	Title string `json:"title"`
}

func (h *ChatHandler) RenameConversation(c *gin.Context) {
	userID, err := getUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
		return
	}

	convID := strings.TrimSpace(c.Param("conversationID"))
	if convID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "conversation id is required"})
		return
	}

	var req RenameConversationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request payload"})
		return
	}

	title := strings.TrimSpace(req.Title)
	if title == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "title is required"})
		return
	}

	// Verify ownership
	if _, err := h.convRepo.GetByID(userID, convID); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "conversation not found"})
		return
	}

	if err := h.convRepo.UpdateTitle(userID, convID, title); err != nil {
		log.Printf("chat: failed to rename conversation %s: %v", convID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to rename conversation"})
		return
	}

	// Re-fetch to return full updated object
	conv, err := h.convRepo.GetByID(userID, convID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to fetch conversation"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"conversation": conv})
}

func (h *ChatHandler) GetMessages(c *gin.Context) {
	userID, err := getUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
		return
	}

	convID := strings.TrimSpace(c.Param("conversationID"))
	if convID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "conversation id is required"})
		return
	}

	// Verify ownership
	if _, err := h.convRepo.GetByID(userID, convID); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "conversation not found"})
		return
	}

	messages, err := h.msgRepo.ListByConversation(convID)
	if err != nil {
		log.Printf("chat: failed to list messages for %s: %v", convID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load messages"})
		return
	}

	// Only return user-visible messages: skip tool result rows and intermediate
	// assistant messages (those that carry tool_calls for API reconstruction but
	// have no final text to display). Intermediate messages are identified by
	// their ToolCalls JSON containing an "id" field (the intermediateToolCall format).
	display := make([]models.Message, 0, len(messages))
	for _, msg := range messages {
		if msg.Role == "tool" {
			continue
		}
		if msg.Role == "assistant" && msg.ToolCalls != nil {
			var probe []struct {
				ID string `json:"id"`
			}
			if json.Unmarshal([]byte(*msg.ToolCalls), &probe) == nil && len(probe) > 0 && probe[0].ID != "" {
				continue // intermediate assistant message — not for display
			}
		}
		display = append(display, msg)
	}

	c.JSON(http.StatusOK, gin.H{"messages": display})
}

// chatSystemPrompt is now centralised in prompts package.

func (h *ChatHandler) SendMessage(c *gin.Context) {
	userID, err := getUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
		return
	}

	convID := strings.TrimSpace(c.Param("conversationID"))
	if convID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "conversation id is required"})
		return
	}

	conv, err := h.convRepo.GetByID(userID, convID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "conversation not found"})
		return
	}

	var req SendMessageRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request payload"})
		return
	}

	content := strings.TrimSpace(req.Content)
	if content == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "message content is required"})
		return
	}

	// Save user message
	userMsg, err := h.msgRepo.Create(&models.Message{
		ConversationID: convID,
		Role:           "user",
		Content:        content,
		TokenCount:     estimateTokens(content),
	})
	if err != nil {
		log.Printf("chat: failed to save user message: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save message"})
		return
	}

	// Build context
	allMessages, err := h.msgRepo.ListByConversation(convID)
	if err != nil {
		log.Printf("chat: failed to load messages: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load conversation"})
		return
	}

	contextMessages, needsSummary := ai.BuildSlidingContext(conv.Summary, allMessages, 80000)

	// Set SSE headers immediately so the client connection is established
	// before the RAG embedding lookup (~500ms) begins.
	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	c.Header("X-Accel-Buffering", "no")
	c.Writer.WriteHeader(http.StatusOK)
	c.Writer.Flush()

	// Derive active note from the conversation's scope
	activeNoteID := ""
	if conv.NoteID != nil {
		activeNoteID = *conv.NoteID
	}

	tools := h.toolExecutor.GetReadOnlyToolDefinitions()
	if conv.NoteID != nil {
		tools = h.toolExecutor.GetToolDefinitions()
	}

	chatParams := ai.ChatParams{
		SystemPrompt: prompts.ChatSystemWithContext(activeNoteID, "") + "\n\nCurrent date and time: " + time.Now().Format("2006-01-02 15:04 MST"),
		Messages:     contextMessages,
		Tools:        tools,
	}

	sr, err := h.streamResponse(c, userID, convID, activeNoteID, chatParams)
	if err != nil {
		writeSSE(c, "error", map[string]interface{}{"error": err.Error()})
		return
	}

	// Serialize tool usage to JSON for storage
	var toolCallsJSON *string
	if len(sr.ToolsUsed) > 0 {
		b, _ := json.Marshal(sr.ToolsUsed)
		s := string(b)
		toolCallsJSON = &s
	}

	// Save assistant message
	savedMsg, err := h.msgRepo.Create(&models.Message{
		ConversationID:   convID,
		Role:             "assistant",
		Content:          sr.Text,
		ToolCalls:        toolCallsJSON,
		Thinking:         sr.Thinking,
		ThinkingDuration: sr.ThinkingDuration,
		TokenCount:       sr.TokenCount,
	})
	if err != nil {
		log.Printf("chat: failed to save assistant message: %v", err)
	}

	// Send done event with saved message
	doneData := map[string]interface{}{
		"message":      savedMsg,
		"user_message": userMsg,
	}
	writeSSE(c, "done", doneData)
	c.Writer.Flush()

	// Generate title after first exchange (allMessages includes the user message we just saved)
	// Done synchronously so the SSE connection stays open for the title event
	if len(allMessages) == 1 {
		title := h.generateAndUpdateTitle(conv.UserID, conv.ID, userMsg.Content, sr.Text)
		if title != "" {
			writeSSE(c, "title", map[string]interface{}{"title": title})
			c.Writer.Flush()
		}
	}

	// Handle summary update async
	if needsSummary {
		go func() {
			h.updateSummary(conv, allMessages)
		}()
	}
}

type toolUsageEntry struct {
	ToolName string `json:"tool_name"`
	Result   string `json:"result,omitempty"`
}

type streamResult struct {
	Text             string
	TokenCount       int
	Thinking         string
	ThinkingDuration int
	ToolsUsed        []toolUsageEntry
}

// intermediateToolCall is the JSON format stored on assistant messages mid-loop.
// The presence of a non-empty ID distinguishes it from the display-only toolUsageEntry format.
type intermediateToolCall struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Args string `json:"args"`
}

func (h *ChatHandler) streamResponse(c *gin.Context, userID, convID, activeNoteID string, params ai.ChatParams) (*streamResult, error) {
	ctx := c.Request.Context()

	messages := params.Messages
	var fullText strings.Builder
	var toolsUsed []toolUsageEntry
	totalTokens := 0

	onEvent := func(event ai.SSEEvent) {
		switch event.Type {
		case "text_delta":
			writeSSE(c, "text_delta", map[string]interface{}{"text": event.Text})
			c.Writer.Flush()
		case "tool_use":
			writeSSE(c, "tool_use", map[string]interface{}{
				"tool_name": event.ToolName,
				"tool_id":   event.ToolUseID,
			})
			c.Writer.Flush()
		}
	}

	for {
		result, err := h.aiClient.StreamChatTurn(ctx, params.SystemPrompt, messages, params.Tools, onEvent)
		if err != nil {
			return nil, fmt.Errorf("stream failed: %w", err)
		}

		fullText.WriteString(result.Text)
		totalTokens += result.TokenCount

		// No tool use — we're done
		if len(result.ToolUses) == 0 {
			return &streamResult{
				Text:       fullText.String(),
				TokenCount: totalTokens,
				ToolsUsed:  toolsUsed,
			}, nil
		}

		// Persist intermediate assistant message so the next turn can reconstruct tool_calls
		itcs := make([]intermediateToolCall, len(result.ToolUses))
		for i, tu := range result.ToolUses {
			itcs[i] = intermediateToolCall{ID: tu.ID, Name: tu.Name, Args: tu.Input}
		}
		if b, err := json.Marshal(itcs); err == nil {
			s := string(b)
			if _, err := h.msgRepo.Create(&models.Message{
				ConversationID: convID,
				Role:           "assistant",
				Content:        result.Text,
				ToolCalls:      &s,
				TokenCount:     result.TokenCount,
			}); err != nil {
				log.Printf("chat: failed to save intermediate assistant message: %v", err)
			}
		}

		// Append assistant message with tool calls, then execute tools
		messages = append(messages, result.AssistantMessage)
		for _, tu := range result.ToolUses {
			toolResult, execErr := h.toolExecutor.Execute(ctx, userID, activeNoteID, tu.Name, json.RawMessage(tu.Input))
			if execErr != nil {
				toolResult = fmt.Sprintf("Tool error: %s", execErr.Error())
			}

			log.Printf("tool [%s] completed", tu.Name)

			writeSSE(c, "tool_result", map[string]interface{}{
				"tool_name": tu.Name,
				"result":    toolResult,
			})
			c.Writer.Flush()

			// Notify frontend when a note was edited so the editor can refresh
			if tu.Name == "edit_note" && execErr == nil && activeNoteID != "" {
				var editInput struct {
					Content string `json:"content"`
				}
				if json.Unmarshal([]byte(tu.Input), &editInput) == nil {
					writeSSE(c, "note_updated", map[string]interface{}{
						"note_id": activeNoteID,
						"content": editInput.Content,
					})
					c.Writer.Flush()
				}
			}

			toolsUsed = append(toolsUsed, toolUsageEntry{ToolName: tu.Name, Result: toolResult})

			// Persist tool result message
			toolCallID := tu.ID
			if _, err := h.msgRepo.Create(&models.Message{
				ConversationID: convID,
				Role:           "tool",
				Content:        toolResult,
				ToolCallID:     &toolCallID,
				TokenCount:     estimateTokens(toolResult),
			}); err != nil {
				log.Printf("chat: failed to save tool result message: %v", err)
			}

			messages = append(messages, ai.Message{Role: "tool", ToolCallID: tu.ID, Content: toolResult})
		}
	}
}

func (h *ChatHandler) generateAndUpdateTitle(userID, convID, userMsg, assistantMsg string) string {
	// Truncate messages if too long
	if len(userMsg) > 200 {
		userMsg = userMsg[:200] + "..."
	}
	if len(assistantMsg) > 200 {
		assistantMsg = assistantMsg[:200] + "..."
	}

	prompt := "Generate a short, descriptive title (2-5 words) for this conversation. Only return the title, nothing else.\n\nUser: " + userMsg + "\n\nAssistant: " + assistantMsg + "\n\nTitle:"

	title, err := h.aiClient.Generate(context.Background(), "", prompt)
	if err != nil {
		log.Printf("chat: failed to generate title: %v", err)
		return ""
	}

	// Clean up the title
	title = strings.TrimSpace(title)
	title = strings.Trim(title, "\"'")
	if len(title) > 100 {
		title = title[:100]
	}
	if title == "" {
		return ""
	}

	// Update conversation title
	if err := h.convRepo.UpdateTitle(userID, convID, title); err != nil {
		log.Printf("chat: failed to update title: %v", err)
	}

	return title
}

func (h *ChatHandler) updateSummary(conv *models.Conversation, messages []models.Message) {
	// Get messages that need summarizing
	var toSummarize []models.Message
	if conv.SummaryThroughMessageID != nil {
		after, err := h.msgRepo.GetMessagesAfter(conv.ID, *conv.SummaryThroughMessageID)
		if err != nil {
			log.Printf("chat: failed to get messages for summary: %v", err)
			return
		}
		toSummarize = after
	} else {
		toSummarize = messages
	}

	if len(toSummarize) < 10 {
		return
	}

	summary, err := h.aiClient.Summarize(context.Background(), conv.Summary, toSummarize)
	if err != nil {
		log.Printf("chat: failed to generate summary: %v", err)
		return
	}

	lastMsg := toSummarize[len(toSummarize)-1]
	if err := h.convRepo.UpdateSummary(conv.UserID, conv.ID, summary, lastMsg.ID); err != nil {
		log.Printf("chat: failed to save summary: %v", err)
	}
}

func writeSSE(c *gin.Context, eventType string, data map[string]interface{}) {
	data["type"] = eventType
	jsonData, err := json.Marshal(data)
	if err != nil {
		return
	}
	fmt.Fprintf(c.Writer, "data: %s\n\n", jsonData)
}

func estimateTokens(text string) int {
	// Rough estimate: ~4 characters per token
	return len(text) / 4
}

func nilIfEmpty(s *string) *string {
	if s == nil || *s == "" {
		return nil
	}
	return s
}

func nilIfEmptyStr(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}
