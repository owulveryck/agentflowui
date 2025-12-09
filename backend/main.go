package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/owulveryck/agentflowui/backend/api"
	"github.com/owulveryck/agentflowui/backend/config"
	"github.com/owulveryck/agentflowui/backend/gdrive"
	"github.com/rs/cors"
	"google.golang.org/genai"
)

func main() {
	ctx := context.Background()

	// Load configuration
	cfg := config.Load()

	// Validate required configuration
	if cfg.GCPProject == "" {
		log.Fatal("GCP_PROJECT environment variable is required")
	}

	log.Printf("Starting AgentFlowUI Backend")
	log.Printf("GCP Project: %s", cfg.GCPProject)
	log.Printf("GCP Location: %s", cfg.GCPLocation)
	log.Printf("Port: %d", cfg.Port)
	log.Printf("Allowed Origins: %v", cfg.AllowedOrigins)

	// Initialize Vertex AI client
	vertexClient, err := genai.NewClient(ctx, &genai.ClientConfig{
		Project:  cfg.GCPProject,
		Location: cfg.GCPLocation,
		Backend:  genai.BackendVertexAI,
	})
	if err != nil {
		log.Fatalf("Failed to create Vertex AI client: %v", err)
	}

	log.Printf("Vertex AI client initialized successfully")

	// Initialize Google Drive client
	gdriveClient := gdrive.NewClient(&http.Client{
		Timeout: 60 * time.Second, // Generous timeout for large file downloads
	})

	// Initialize handler
	handler := api.NewHandler(vertexClient, gdriveClient, cfg.GeminiModels)

	// Setup routes
	mux := http.NewServeMux()
	mux.HandleFunc("/v1/chat/completions", handler.HandleChatCompletion)
	mux.HandleFunc("/v1/models", handler.HandleListModels)
	mux.HandleFunc("/v1/models/", handler.HandleGetModel)
	mux.HandleFunc("/health", handler.HandleHealth)

	// Get the parent directory (project root) to serve static files
	execPath, err := os.Getwd()
	if err != nil {
		log.Fatalf("Failed to get working directory: %v", err)
	}
	staticDir := filepath.Dir(execPath)

	// If we're already in the backend directory, go up one level
	if filepath.Base(execPath) == "backend" {
		staticDir = filepath.Dir(execPath)
	} else {
		// We're in the root directory, use current directory
		staticDir = execPath
	}

	log.Printf("Serving static files from: %s", staticDir)

	// Serve static files at root path
	fileServer := http.FileServer(http.Dir(staticDir))
	mux.Handle("/", fileServer)

	// Add logging middleware
	loggedMux := loggingMiddleware(mux)

	// Configure CORS
	corsHandler := cors.New(cors.Options{
		AllowedOrigins:   cfg.AllowedOrigins,
		AllowedMethods:   []string{"GET", "POST", "OPTIONS"},
		AllowedHeaders:   []string{"Content-Type", "X-Google-Drive-Token"},
		AllowCredentials: true,
		Debug:            false,
	}).Handler(loggedMux)

	// Start server
	addr := fmt.Sprintf(":%d", cfg.Port)
	log.Printf("Server listening on %s", addr)
	log.Printf("Static files: http://localhost:%d/", cfg.Port)
	log.Printf("Chat completions endpoint: http://localhost:%d/v1/chat/completions", cfg.Port)
	log.Printf("Models endpoint: http://localhost:%d/v1/models", cfg.Port)
	log.Printf("Health check endpoint: http://localhost:%d/health", cfg.Port)
	log.Printf("Available models: %v", cfg.GeminiModels)

	if err := http.ListenAndServe(addr, corsHandler); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}

// loggingMiddleware logs HTTP requests
func loggingMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()

		// Log request
		log.Printf("%s %s from %s", r.Method, r.URL.Path, r.RemoteAddr)

		// Call next handler
		next.ServeHTTP(w, r)

		// Log completion
		duration := time.Since(start)
		log.Printf("Completed %s %s in %v", r.Method, r.URL.Path, duration)
	})
}
