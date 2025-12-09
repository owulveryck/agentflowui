package gdrive

import (
	"fmt"
	"io"
	"net/http"
	"strings"
)

// Client handles Google Drive file operations
type Client struct {
	httpClient *http.Client
}

// NewClient creates a new Google Drive client
func NewClient(httpClient *http.Client) *Client {
	return &Client{
		httpClient: httpClient,
	}
}

// DownloadFile fetches a file from Google Drive using an access token
// Returns the file data, MIME type, and any error
func (c *Client) DownloadFile(fileID, accessToken string) ([]byte, string, error) {
	url := fmt.Sprintf("https://www.googleapis.com/drive/v3/files/%s?alt=media", fileID)

	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return nil, "", fmt.Errorf("failed to create request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, "", fmt.Errorf("failed to download file: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, "", fmt.Errorf("google drive download failed with status %d: %s", resp.StatusCode, string(body))
	}

	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, "", fmt.Errorf("failed to read response body: %w", err)
	}

	mimeType := resp.Header.Get("Content-Type")
	return data, mimeType, nil
}

// IsGDriveURL checks if a URL is in gdrive:// format
func IsGDriveURL(url string) bool {
	return strings.HasPrefix(url, "gdrive://")
}

// ExtractFileID extracts the file ID from a gdrive://fileId URL
func ExtractFileID(gdriveURL string) string {
	return strings.TrimPrefix(gdriveURL, "gdrive://")
}
