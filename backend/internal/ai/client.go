package ai

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/mouizahmed/justscribe-backend/internal/models"
	openai "github.com/sashabaranov/go-openai"
)

type ToolDefinition struct {
	Name        string
	Description string
	Properties  map[string]interface{}
	Required    []string
}

type ToolCall struct {
	ID    string
	Name  string
	Input string // JSON
}

type Message struct {
	Role       string // "user" | "assistant" | "tool"
	Content    string
	ToolCalls  []ToolCall // non-empty on assistant messages that invoked tools
	ToolCallID string     // set on role="tool" result messages
}

type ChatParams struct {
	SystemPrompt string
	Messages     []Message
	Tools        []ToolDefinition
}

type SSEEvent struct {
	Type       string `json:"type"`
	Text       string `json:"text,omitempty"`
	ToolName   string `json:"tool_name,omitempty"`
	ToolInput  string `json:"tool_input,omitempty"`
	ToolUseID  string `json:"tool_use_id,omitempty"`
	TokenCount int    `json:"token_count,omitempty"`
}

type ToolUseInfo struct {
	ID    string
	Name  string
	Input string // JSON string
}

type TurnResult struct {
	Text             string
	ToolUses         []ToolUseInfo
	TokenCount       int
	AssistantMessage Message // pre-built for multi-turn reconstruction
}

type Client struct {
	openaiClient  *openai.Client
	generateModel string
	chatModel     string
}

func NewClient() *Client {
	apiKey := os.Getenv("OPENROUTER_API_KEY")
	generateModel := os.Getenv("OPENROUTER_GENERATE_MODEL")
	if generateModel == "" {
		generateModel = "google/gemini-flash-1.5"
	}
	chatModel := os.Getenv("OPENROUTER_CHAT_MODEL")
	if chatModel == "" {
		chatModel = "google/gemini-flash-1.5"
	}

	config := openai.DefaultConfig(apiKey)
	config.BaseURL = "https://openrouter.ai/api/v1"
	client := openai.NewClientWithConfig(config)

	return &Client{
		openaiClient:  client,
		generateModel: generateModel,
		chatModel:     chatModel,
	}
}

func (c *Client) Generate(ctx context.Context, systemPrompt, userContent string) (string, error) {
	return c.generate(ctx, systemPrompt, userContent, nil)
}

func (c *Client) GenerateJSON(ctx context.Context, systemPrompt, userContent string) (string, error) {
	return c.generate(ctx, systemPrompt, userContent, &openai.ChatCompletionResponseFormat{
		Type: openai.ChatCompletionResponseFormatTypeJSONObject,
	})
}

func (c *Client) generate(
	ctx context.Context,
	systemPrompt string,
	userContent string,
	responseFormat *openai.ChatCompletionResponseFormat,
) (string, error) {
	messages := []openai.ChatCompletionMessage{}
	if systemPrompt != "" {
		messages = append(messages, openai.ChatCompletionMessage{
			Role:    openai.ChatMessageRoleSystem,
			Content: systemPrompt,
		})
	}
	messages = append(messages, openai.ChatCompletionMessage{
		Role:    openai.ChatMessageRoleUser,
		Content: userContent,
	})

	resp, err := c.openaiClient.CreateChatCompletion(ctx, openai.ChatCompletionRequest{
		Model:          c.generateModel,
		Messages:       messages,
		MaxTokens:      4096,
		ResponseFormat: responseFormat,
	})
	if err != nil {
		return "", fmt.Errorf("failed to generate: %w", err)
	}
	if len(resp.Choices) == 0 {
		return "", fmt.Errorf("no choices returned")
	}

	return resp.Choices[0].Message.Content, nil
}

func (c *Client) StreamChatTurn(
	ctx context.Context,
	systemPrompt string,
	messages []Message,
	tools []ToolDefinition,
	onEvent func(SSEEvent),
) (*TurnResult, error) {
	// Convert messages to OpenAI format
	oaiMessages := []openai.ChatCompletionMessage{}
	if systemPrompt != "" {
		oaiMessages = append(oaiMessages, openai.ChatCompletionMessage{
			Role:    openai.ChatMessageRoleSystem,
			Content: systemPrompt,
		})
	}
	for _, m := range messages {
		oaiMsg := openai.ChatCompletionMessage{
			Role:    m.Role,
			Content: m.Content,
		}
		if m.ToolCallID != "" {
			oaiMsg.ToolCallID = m.ToolCallID
		}
		if len(m.ToolCalls) > 0 {
			for _, tc := range m.ToolCalls {
				oaiMsg.ToolCalls = append(oaiMsg.ToolCalls, openai.ToolCall{
					ID:   tc.ID,
					Type: openai.ToolTypeFunction,
					Function: openai.FunctionCall{
						Name:      tc.Name,
						Arguments: tc.Input,
					},
				})
			}
		}
		oaiMessages = append(oaiMessages, oaiMsg)
	}

	// Convert tools to OpenAI format
	var oaiTools []openai.Tool
	for _, t := range tools {
		oaiTools = append(oaiTools, openai.Tool{
			Type: openai.ToolTypeFunction,
			Function: &openai.FunctionDefinition{
				Name:        t.Name,
				Description: t.Description,
				Parameters: map[string]interface{}{
					"type":       "object",
					"properties": t.Properties,
					"required":   t.Required,
				},
			},
		})
	}

	req := openai.ChatCompletionRequest{
		Model:     c.chatModel,
		Messages:  oaiMessages,
		MaxTokens: 16000,
		Stream:    true,
	}
	if len(oaiTools) > 0 {
		req.Tools = oaiTools
	}

	stream, err := c.openaiClient.CreateChatCompletionStream(ctx, req)
	if err != nil {
		return nil, fmt.Errorf("failed to create stream: %w", err)
	}
	defer stream.Close()

	type partialToolCall struct {
		id   string
		name string
		args strings.Builder
	}
	toolCallMap := map[int]*partialToolCall{}
	var textBuilder strings.Builder

	for {
		response, err := stream.Recv()
		if err != nil {
			if errors.Is(err, io.EOF) {
				break
			}
			return nil, fmt.Errorf("stream error: %w", err)
		}

		if len(response.Choices) == 0 {
			continue
		}

		delta := response.Choices[0].Delta
		if delta.Content != "" {
			textBuilder.WriteString(delta.Content)
			onEvent(SSEEvent{Type: "text_delta", Text: delta.Content})
		}

		for _, tc := range delta.ToolCalls {
			if tc.Index == nil {
				continue
			}
			i := *tc.Index
			if _, ok := toolCallMap[i]; !ok {
				toolCallMap[i] = &partialToolCall{}
			}
			ptc := toolCallMap[i]
			if tc.ID != "" {
				ptc.id = tc.ID
			}
			if tc.Function.Name != "" {
				ptc.name = tc.Function.Name
			}
			ptc.args.WriteString(tc.Function.Arguments)
		}
	}

	result := &TurnResult{
		Text: textBuilder.String(),
	}

	// Build tool uses from accumulated tool calls (in index order)
	var assistantToolCalls []ToolCall
	for i := 0; i < len(toolCallMap); i++ {
		ptc, ok := toolCallMap[i]
		if !ok {
			continue
		}
		input := ptc.args.String()
		result.ToolUses = append(result.ToolUses, ToolUseInfo{
			ID:    ptc.id,
			Name:  ptc.name,
			Input: input,
		})
		assistantToolCalls = append(assistantToolCalls, ToolCall{
			ID:    ptc.id,
			Name:  ptc.name,
			Input: input,
		})
		onEvent(SSEEvent{
			Type:      "tool_use",
			ToolName:  ptc.name,
			ToolUseID: ptc.id,
			ToolInput: input,
		})
	}

	result.AssistantMessage = Message{
		Role:      "assistant",
		Content:   result.Text,
		ToolCalls: assistantToolCalls,
	}

	return result, nil
}

func (c *Client) Summarize(ctx context.Context, existingSummary string, messages []models.Message) (string, error) {
	var content strings.Builder
	if existingSummary != "" {
		content.WriteString("Previous conversation summary:\n")
		content.WriteString(existingSummary)
		content.WriteString("\n\nNew messages to incorporate:\n")
	} else {
		content.WriteString("Messages to summarize:\n")
	}

	for _, msg := range messages {
		content.WriteString(fmt.Sprintf("[%s]: %s\n", msg.Role, msg.Content))
	}

	systemPrompt := `You are a conversation summarizer. Create a concise summary of the conversation that captures the key topics discussed, important details, decisions made, and any action items. The summary should be detailed enough that someone could continue the conversation naturally. Keep it under 500 words. Output only the summary, no preamble.`

	return c.Generate(ctx, systemPrompt, content.String())
}
