#!/bin/bash

# AgentFlow UI - Quick Start Script
# Starts a local web server for the UI

echo "🚀 Starting AgentFlow UI..."
echo ""
echo "Configuration:"
echo "  - UI Server: http://localhost:8080"
echo "  - API Server: http://localhost:4000 (assumed running)"
echo "  - Artifact Server: http://localhost:4000/artifact (optional)"
echo ""
echo "Opening browser at: http://localhost:8080/index.html"
echo ""
echo "Press Ctrl+C to stop the server"
echo "---"

# Check if API server is reachable
if curl -s -o /dev/null -w "%{http_code}" http://localhost:4000/v1/models | grep -q "200\|404"; then
    echo "✅ API server is reachable at http://localhost:4000"
else
    echo "⚠️  Warning: API server not responding at http://localhost:4000"
    echo "   Make sure your API server is running!"
fi

echo ""

# Start Python HTTP server
python3 -m http.server 8080
