package config

import (
	"os"
	"strconv"
	"strings"
)

// Config holds the application configuration
type Config struct {
	GCPProject     string
	GCPLocation    string
	Port           int
	AllowedOrigins []string
	MaxFileSize    int64    // in bytes
	GeminiModels   []string // List of available Gemini models
}

// Load loads configuration from environment variables
func Load() *Config {
	return &Config{
		GCPProject:     getEnv("GCP_PROJECT", ""),
		GCPLocation:    getEnv("GCP_LOCATION", "us-central1"),
		Port:           getEnvInt("PORT", 8080),
		AllowedOrigins: getAllowedOrigins(),
		MaxFileSize:    50 * 1024 * 1024, // 50MB default
		GeminiModels:   getGeminiModels(),
	}
}

// getEnv gets an environment variable or returns a default value
func getEnv(key, defaultValue string) string {
	value := os.Getenv(key)
	if value == "" {
		return defaultValue
	}
	return value
}

// getEnvInt gets an integer environment variable or returns a default value
func getEnvInt(key string, defaultValue int) int {
	valueStr := os.Getenv(key)
	if valueStr == "" {
		return defaultValue
	}

	value, err := strconv.Atoi(valueStr)
	if err != nil {
		return defaultValue
	}

	return value
}

// getAllowedOrigins gets the list of allowed CORS origins
func getAllowedOrigins() []string {
	originsStr := getEnv("ALLOWED_ORIGINS", "http://localhost:8000,http://localhost:3000,http://localhost:8080")
	origins := strings.Split(originsStr, ",")

	// Trim whitespace
	for i, origin := range origins {
		origins[i] = strings.TrimSpace(origin)
	}

	return origins
}

// getGeminiModels gets the list of Gemini models from environment variables
func getGeminiModels() []string {
	modelsStr := getEnv("GEMINI_MODELS", "gemini-1.5-pro,gemini-2.0-flash")
	models := strings.Split(modelsStr, ",")

	// Trim whitespace
	for i, model := range models {
		models[i] = strings.TrimSpace(model)
	}

	return models
}
