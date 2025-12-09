package models

// ChatCompletionRequest represents an OpenAI-compatible chat completion request
type ChatCompletionRequest struct {
	Model       string    `json:"model"`
	Messages    []Message `json:"messages"`
	Stream      bool      `json:"stream"`
	Temperature *float32  `json:"temperature,omitempty"`
	MaxTokens   *int      `json:"max_tokens,omitempty"`
}

// Message represents a chat message
type Message struct {
	Role    string      `json:"role"`    // "user", "assistant", "system"
	Content interface{} `json:"content"` // string or []map[string]interface{}
}

// ContentPart represents a part of multimodal content
type ContentPart struct {
	Type     string           `json:"type"` // "text", "image_url", "audio", "file"
	Text     *string          `json:"text,omitempty"`
	ImageURL *ImageURLContent `json:"image_url,omitempty"`
	Audio    *AudioContent    `json:"audio,omitempty"`
	File     *FileContent     `json:"file,omitempty"`
}

// ImageURLContent represents image content
type ImageURLContent struct {
	URL       string `json:"url"` // Can be "gdrive://fileId" or "data:image/..."
	GDriveURL string `json:"_gdriveUrl,omitempty"`
}

// AudioContent represents audio content
type AudioContent struct {
	Data      string `json:"data"` // Can be "gdrive://fileId" or "data:audio/..."
	GDriveURL string `json:"_gdriveUrl,omitempty"`
}

// FileContent represents file content (e.g., PDF)
type FileContent struct {
	FileData  string `json:"file_data"` // Can be "gdrive://fileId" or "data:application/..."
	Filename  string `json:"filename"`
	GDriveURL string `json:"_gdriveUrl,omitempty"`
}

// ChatCompletionChunk represents a streaming response chunk
type ChatCompletionChunk struct {
	ID      string   `json:"id"`
	Object  string   `json:"object"` // "chat.completion.chunk"
	Created int64    `json:"created"`
	Model   string   `json:"model"`
	Choices []Choice `json:"choices"`
}

// Choice represents a completion choice
type Choice struct {
	Index        int     `json:"index"`
	Delta        Delta   `json:"delta"`
	FinishReason *string `json:"finish_reason,omitempty"` // null, "stop", "length"
}

// Delta represents the incremental content in a streaming response
type Delta struct {
	Role    string `json:"role,omitempty"`
	Content string `json:"content,omitempty"`
}

// ChatCompletionResponse represents a non-streaming response
type ChatCompletionResponse struct {
	ID      string          `json:"id"`
	Object  string          `json:"object"` // "chat.completion"
	Created int64           `json:"created"`
	Model   string          `json:"model"`
	Choices []MessageChoice `json:"choices"`
}

// MessageChoice represents a complete message choice
type MessageChoice struct {
	Index        int     `json:"index"`
	Message      Message `json:"message"`
	FinishReason string  `json:"finish_reason"` // "stop", "length"
}

// Model represents a language model
type Model struct {
	ID      string `json:"id"`
	Object  string `json:"object"`
	Created int64  `json:"created"`
	OwnedBy string `json:"owned_by"`
}

// ListModelsResponse represents the response for listing models
type ListModelsResponse struct {
	Object string  `json:"object"`
	Data   []Model `json:"data"`
}
