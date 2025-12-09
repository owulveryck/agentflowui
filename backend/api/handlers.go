package api

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"

	"github.com/owulveryck/agentflowui/backend/gdrive"
	"github.com/owulveryck/agentflowui/backend/models"
	"github.com/owulveryck/agentflowui/backend/vertexai"
	"google.golang.org/genai"
)

// Handler handles HTTP requests
type Handler struct {
	vertexClient *genai.Client
	gdriveClient *gdrive.Client
	modelNames   []string
}

// NewHandler creates a new HTTP handler
func NewHandler(vertexClient *genai.Client, gdriveClient *gdrive.Client, modelNames []string) *Handler {
	return &Handler{
		vertexClient: vertexClient,
		gdriveClient: gdriveClient,
		modelNames:   modelNames,
	}
}

// HandleChatCompletion handles the /v1/chat/completions endpoint
func (h *Handler) HandleChatCompletion(w http.ResponseWriter, r *http.Request) {
	// Only accept POST requests
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Parse request body
	var req models.ChatCompletionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		log.Printf("Failed to decode request: %v", err)
		http.Error(w, fmt.Sprintf("invalid request: %v", err), http.StatusBadRequest)
		return
	}

	// Extract Google Drive auth token from header
	gdriveToken := r.Header.Get("X-Google-Drive-Token")

	// Check if any messages contain gdrive:// URLs
	hasGDriveURLs := h.containsGDriveURLs(req.Messages)

	// Validate token presence if gdrive:// URLs exist
	if hasGDriveURLs && gdriveToken == "" {
		http.Error(w, "missing Google Drive token for gdrive:// URLs", http.StatusUnauthorized)
		return
	}

	// Process messages: download gdrive:// files and convert to base64
	processedMessages, err := h.processMessages(req.Messages, gdriveToken)
	if err != nil {
		log.Printf("Failed to process messages: %v", err)
		http.Error(w, fmt.Sprintf("failed to process messages: %v", err), http.StatusBadGateway)
		return
	}

	// Convert messages to Vertex AI format
	contents, err := vertexai.ConvertToVertexAI(processedMessages)
	if err != nil {
		log.Printf("Failed to convert messages: %v", err)
		http.Error(w, fmt.Sprintf("failed to convert messages: %v", err), http.StatusInternalServerError)
		return
	}

	// Handle streaming vs non-streaming
	if req.Stream {
		err = vertexai.StreamResponse(r.Context(), h.vertexClient, req.Model, contents, w)
		if err != nil {
			log.Printf("Streaming error: %v", err)
			// Can't send error response as headers already sent
		}
	} else {
		err = vertexai.NonStreamingResponse(r.Context(), h.vertexClient, req.Model, contents, w)
		if err != nil {
			log.Printf("Non-streaming error: %v", err)
			http.Error(w, fmt.Sprintf("failed to generate response: %v", err), http.StatusInternalServerError)
		}
	}
}

// processMessages processes messages by downloading gdrive:// files and converting to base64
func (h *Handler) processMessages(messages []models.Message, gdriveToken string) ([]models.Message, error) {
	processedMessages := make([]models.Message, len(messages))

	for i, msg := range messages {
		// If content is a string, no processing needed
		if text, ok := msg.Content.(string); ok {
			processedMessages[i] = models.Message{
				Role:    msg.Role,
				Content: text,
			}
			continue
		}

		// Handle multimodal content
		contentArray, ok := msg.Content.([]interface{})
		if !ok {
			processedMessages[i] = msg
			continue
		}

		processedParts := make([]interface{}, len(contentArray))

		for j, item := range contentArray {
			partMap, ok := item.(map[string]interface{})
			if !ok {
				processedParts[j] = item
				continue
			}

			// Make a copy to avoid modifying original
			processedPart := make(map[string]interface{})
			for k, v := range partMap {
				processedPart[k] = v
			}

			partType, _ := partMap["type"].(string)

			switch partType {
			case "image_url":
				if imageURL, ok := partMap["image_url"].(map[string]interface{}); ok {
					if url, ok := imageURL["url"].(string); ok && gdrive.IsGDriveURL(url) {
						// Download from Google Drive
						fileID := gdrive.ExtractFileID(url)
						data, mimeType, err := h.gdriveClient.DownloadFile(fileID, gdriveToken)
						if err != nil {
							return nil, fmt.Errorf("failed to download image %s: %w", fileID, err)
						}

						// Convert to base64 data URL
						dataURL := vertexai.ToDataURL(data, mimeType)

						// Update the URL
						imageURLCopy := make(map[string]interface{})
						for k, v := range imageURL {
							imageURLCopy[k] = v
						}
						imageURLCopy["url"] = dataURL
						processedPart["image_url"] = imageURLCopy
					}
				}

			case "audio":
				if audio, ok := partMap["audio"].(map[string]interface{}); ok {
					if dataStr, ok := audio["data"].(string); ok && gdrive.IsGDriveURL(dataStr) {
						// Download from Google Drive
						fileID := gdrive.ExtractFileID(dataStr)
						data, mimeType, err := h.gdriveClient.DownloadFile(fileID, gdriveToken)
						if err != nil {
							return nil, fmt.Errorf("failed to download audio %s: %w", fileID, err)
						}

						// Convert to base64 data URL
						dataURL := vertexai.ToDataURL(data, mimeType)

						// Update the data field
						audioCopy := make(map[string]interface{})
						for k, v := range audio {
							audioCopy[k] = v
						}
						audioCopy["data"] = dataURL
						processedPart["audio"] = audioCopy
					}
				}

			case "file":
				if file, ok := partMap["file"].(map[string]interface{}); ok {
					if fileData, ok := file["file_data"].(string); ok && gdrive.IsGDriveURL(fileData) {
						// Download from Google Drive
						fileID := gdrive.ExtractFileID(fileData)
						data, mimeType, err := h.gdriveClient.DownloadFile(fileID, gdriveToken)
						if err != nil {
							return nil, fmt.Errorf("failed to download file %s: %w", fileID, err)
						}

						// Convert to base64 data URL
						dataURL := vertexai.ToDataURL(data, mimeType)

						// Update the file_data field
						fileCopy := make(map[string]interface{})
						for k, v := range file {
							fileCopy[k] = v
						}
						fileCopy["file_data"] = dataURL
						processedPart["file"] = fileCopy
					}
				}
			}

			processedParts[j] = processedPart
		}

		processedMessages[i] = models.Message{
			Role:    msg.Role,
			Content: processedParts,
		}
	}

	return processedMessages, nil
}

// containsGDriveURLs checks if any message contains gdrive:// URLs
func (h *Handler) containsGDriveURLs(messages []models.Message) bool {
	for _, msg := range messages {
		// Skip string content
		if _, ok := msg.Content.(string); ok {
			continue
		}

		// Check multimodal content
		contentArray, ok := msg.Content.([]interface{})
		if !ok {
			continue
		}

		for _, item := range contentArray {
			partMap, ok := item.(map[string]interface{})
			if !ok {
				continue
			}

			partType, _ := partMap["type"].(string)

			switch partType {
			case "image_url":
				if imageURL, ok := partMap["image_url"].(map[string]interface{}); ok {
					if url, ok := imageURL["url"].(string); ok && gdrive.IsGDriveURL(url) {
						return true
					}
				}
			case "audio":
				if audio, ok := partMap["audio"].(map[string]interface{}); ok {
					if dataStr, ok := audio["data"].(string); ok && gdrive.IsGDriveURL(dataStr) {
						return true
					}
				}
			case "file":
				if file, ok := partMap["file"].(map[string]interface{}); ok {
					if fileData, ok := file["file_data"].(string); ok && gdrive.IsGDriveURL(fileData) {
						return true
					}
				}
			}
		}
	}

	return false
}

// HandleHealth handles the /health endpoint
func (h *Handler) HandleHealth(w http.ResponseWriter, r *http.Request) {
	w.WriteHeader(http.StatusOK)
	w.Write([]byte("OK"))
}

// HandleListModels handles the /v1/models endpoint
func (h *Handler) HandleListModels(w http.ResponseWriter, r *http.Request) {
	// Only accept GET requests
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Build the models list
	modelsList := make([]models.Model, len(h.modelNames))
	for i, modelName := range h.modelNames {
		modelsList[i] = models.Model{
			ID:      modelName,
			Object:  "model",
			Created: 0,
			OwnedBy: "Google",
		}
	}

	// Create the response
	response := models.ListModelsResponse{
		Object: "list",
		Data:   modelsList,
	}

	// Send the response
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(response); err != nil {
		log.Printf("Failed to encode models response: %v", err)
		http.Error(w, "error marshaling response", http.StatusInternalServerError)
		return
	}
}

// HandleGetModel handles the /v1/models/{model} endpoint
func (h *Handler) HandleGetModel(w http.ResponseWriter, r *http.Request) {
	// Only accept GET requests
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Extract model name from the URL
	modelName := strings.TrimPrefix(r.URL.Path, "/v1/models/")
	if modelName == "" || modelName == r.URL.Path {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}

	// Check if the model exists in the list
	found := false
	for _, name := range h.modelNames {
		if name == modelName {
			found = true
			break
		}
	}

	if !found {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}

	// Create the model response
	model := models.Model{
		ID:      modelName,
		Object:  "model",
		Created: 0,
		OwnedBy: "Google",
	}

	// Send the response
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(model); err != nil {
		log.Printf("Failed to encode model response: %v", err)
		http.Error(w, "error marshaling response", http.StatusInternalServerError)
		return
	}
}
