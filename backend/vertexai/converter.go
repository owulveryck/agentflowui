package vertexai

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/owulveryck/agentflowui/backend/models"
	"google.golang.org/genai"
)

// ConvertToVertexAI converts OpenAI-format messages to Vertex AI GenAI format
func ConvertToVertexAI(messages []models.Message) ([]*genai.Content, error) {
	contents := make([]*genai.Content, 0, len(messages))

	for _, msg := range messages {
		parts := make([]*genai.Part, 0)

		// Handle string content (simple text message)
		if text, ok := msg.Content.(string); ok {
			parts = append(parts, &genai.Part{Text: text})
		} else {
			// Handle multimodal content (array of content parts)
			// The JSON unmarshaler will give us []interface{} containing map[string]interface{}
			contentArray, ok := msg.Content.([]interface{})
			if !ok {
				return nil, fmt.Errorf("invalid message content type: %T", msg.Content)
			}

			for _, item := range contentArray {
				contentMap, ok := item.(map[string]interface{})
				if !ok {
					continue
				}

				partType, _ := contentMap["type"].(string)

				switch partType {
				case "text":
					if textVal, ok := contentMap["text"].(string); ok {
						parts = append(parts, &genai.Part{Text: textVal})
					}

				case "image_url":
					if imageURL, ok := contentMap["image_url"].(map[string]interface{}); ok {
						if url, ok := imageURL["url"].(string); ok {
							data, mimeType, err := parseDataURL(url)
							if err != nil {
								return nil, fmt.Errorf("failed to parse image data URL: %w", err)
							}
							parts = append(parts, &genai.Part{
								InlineData: &genai.Blob{
									Data:     data,
									MIMEType: mimeType,
								},
							})
						}
					}

				case "audio":
					if audio, ok := contentMap["audio"].(map[string]interface{}); ok {
						if dataStr, ok := audio["data"].(string); ok {
							data, mimeType, err := parseDataURL(dataStr)
							if err != nil {
								return nil, fmt.Errorf("failed to parse audio data URL: %w", err)
							}
							parts = append(parts, &genai.Part{
								InlineData: &genai.Blob{
									Data:     data,
									MIMEType: mimeType,
								},
							})
						}
					}

				case "file":
					if file, ok := contentMap["file"].(map[string]interface{}); ok {
						if fileData, ok := file["file_data"].(string); ok {
							data, mimeType, err := parseDataURL(fileData)
							if err != nil {
								return nil, fmt.Errorf("failed to parse file data URL: %w", err)
							}
							parts = append(parts, &genai.Part{
								InlineData: &genai.Blob{
									Data:     data,
									MIMEType: mimeType,
								},
							})
						}
					}
				}
			}
		}

		// Only add content if it has parts
		if len(parts) > 0 {
			// Map OpenAI roles to Vertex AI roles
			role := msg.Role
			if role == "assistant" {
				role = "model"
			}
			// Skip system messages as they're handled differently in Vertex AI
			if msg.Role == "system" {
				continue
			}

			contents = append(contents, &genai.Content{
				Role:  role,
				Parts: parts,
			})
		}
	}

	return contents, nil
}

// parseDataURL extracts binary data and MIME type from a data URL
// Format: data:image/png;base64,iVBORw0KG...
func parseDataURL(dataURL string) ([]byte, string, error) {
	if !strings.HasPrefix(dataURL, "data:") {
		return nil, "", fmt.Errorf("invalid data URL format: missing 'data:' prefix")
	}

	// Split on comma to separate header and data
	parts := strings.SplitN(dataURL, ",", 2)
	if len(parts) != 2 {
		return nil, "", fmt.Errorf("invalid data URL format: missing comma separator")
	}

	header := parts[0] // data:image/png;base64
	encoded := parts[1]

	// Extract MIME type
	// header format: data:image/png;base64
	mimeType := strings.TrimPrefix(header, "data:")
	mimeType = strings.TrimSuffix(mimeType, ";base64")

	// Decode base64
	data, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return nil, "", fmt.Errorf("failed to decode base64: %w", err)
	}

	return data, mimeType, nil
}

// ToDataURL converts binary data to a data URL
func ToDataURL(data []byte, mimeType string) string {
	encoded := base64.StdEncoding.EncodeToString(data)
	return fmt.Sprintf("data:%s;base64,%s", mimeType, encoded)
}

// UnmarshalContentPart unmarshals a content part from a map
func UnmarshalContentPart(partMap map[string]interface{}) (models.ContentPart, error) {
	// Convert map to JSON then unmarshal to ContentPart
	// This handles the complex nested structure properly
	jsonBytes, err := json.Marshal(partMap)
	if err != nil {
		return models.ContentPart{}, err
	}

	var part models.ContentPart
	err = json.Unmarshal(jsonBytes, &part)
	return part, err
}
