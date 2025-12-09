package vertexai

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/owulveryck/agentflowui/backend/models"
	"google.golang.org/genai"
)

// StreamResponse streams Vertex AI responses as Server-Sent Events (SSE)
// in OpenAI-compatible format
func StreamResponse(
	ctx context.Context,
	client *genai.Client,
	model string,
	contents []*genai.Content,
	w http.ResponseWriter,
) error {
	// Set SSE headers
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no") // Disable nginx buffering

	flusher, ok := w.(http.Flusher)
	if !ok {
		return fmt.Errorf("streaming not supported")
	}

	// Generate a unique ID for this completion
	completionID := "chatcmpl-" + uuid.New().String()

	// Call Vertex AI with streaming
	iter := client.Models.GenerateContentStream(ctx, model, contents, nil)

	// Use range to iterate over the stream (new genai SDK API)
	for resp, err := range iter {
		if err != nil {
			log.Printf("Error during streaming: %v", err)
			return fmt.Errorf("streaming error: %w", err)
		}

		// Process each candidate in the response
		if resp.Candidates != nil {
			for _, candidate := range resp.Candidates {
				if candidate.Content != nil && candidate.Content.Parts != nil {
					for _, part := range candidate.Content.Parts {
						// Create SSE chunk
						chunk := models.ChatCompletionChunk{
							ID:      completionID,
							Object:  "chat.completion.chunk",
							Created: time.Now().Unix(),
							Model:   model,
							Choices: []models.Choice{
								{
									Index: 0,
									Delta: models.Delta{
										Content: part.Text,
									},
									FinishReason: nil,
								},
							},
						}

						// Marshal to JSON
						data, err := json.Marshal(chunk)
						if err != nil {
							log.Printf("Error marshaling chunk: %v", err)
							continue
						}

						// Write SSE event
						fmt.Fprintf(w, "data: %s\n\n", data)
						flusher.Flush()
					}
				}
			}
		}
	}

	// Send final chunk with finish_reason
	finishReason := "stop"
	finalChunk := models.ChatCompletionChunk{
		ID:      completionID,
		Object:  "chat.completion.chunk",
		Created: time.Now().Unix(),
		Model:   model,
		Choices: []models.Choice{
			{
				Index:        0,
				Delta:        models.Delta{},
				FinishReason: &finishReason,
			},
		},
	}

	data, _ := json.Marshal(finalChunk)
	fmt.Fprintf(w, "data: %s\n\n", data)
	fmt.Fprintf(w, "data: [DONE]\n\n")
	flusher.Flush()

	return nil
}

// NonStreamingResponse handles non-streaming chat completions
func NonStreamingResponse(
	ctx context.Context,
	client *genai.Client,
	model string,
	contents []*genai.Content,
	w http.ResponseWriter,
) error {
	// Call Vertex AI without streaming
	resp, err := client.Models.GenerateContent(ctx, model, contents, nil)
	if err != nil {
		return fmt.Errorf("generate content error: %w", err)
	}

	// Build complete response
	completionID := "chatcmpl-" + uuid.New().String()
	var fullText string

	if resp.Candidates != nil && len(resp.Candidates) > 0 {
		candidate := resp.Candidates[0]
		if candidate.Content != nil && candidate.Content.Parts != nil {
			for _, part := range candidate.Content.Parts {
				fullText += part.Text
			}
		}
	}

	response := models.ChatCompletionResponse{
		ID:      completionID,
		Object:  "chat.completion",
		Created: time.Now().Unix(),
		Model:   model,
		Choices: []models.MessageChoice{
			{
				Index: 0,
				Message: models.Message{
					Role:    "assistant",
					Content: fullText,
				},
				FinishReason: "stop",
			},
		},
	}

	w.Header().Set("Content-Type", "application/json")
	return json.NewEncoder(w).Encode(response)
}
