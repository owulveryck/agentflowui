# AgentFlow UI - Quick Start

## Prerequisites

✅ API server running on `http://localhost:4000`
✅ Python 3 installed

## Start the UI (30 seconds)

### Option 1: Use the start script

```bash
./start.sh
```

This will:
- Check if API server is reachable
- Start UI server on port 8080
- Open in your default browser

### Option 2: Manual start

```bash
# Start the web server
python3 -m http.server 8080

# Open in browser
open http://localhost:8080/index.html
```

## Test the Connection

1. Open browser at `http://localhost:8080/index.html`
2. Type a message: "Hello!"
3. Press Enter
4. You should see a streaming response from your API server

## What the UI Expects from Your API

The UI is configured to call:

### Chat Endpoint
```http
POST http://localhost:4000/v1/chat/completions
Content-Type: application/json

{
  "model": "gemini-2.0-flash",
  "messages": [
    {
      "role": "system",
      "content": "You are a helpful assistant.\nCurrent time is ..."
    },
    {
      "role": "user",
      "content": "Hello!"
    }
  ],
  "stream": true,
  "temperature": 0.7,
  "max_tokens": 2000
}
```

Expected response: **Server-Sent Events (SSE)**
```
data: {"choices":[{"index":0,"delta":{"content":"Hello"}}]}

data: {"choices":[{"index":0,"delta":{"content":"!"}}]}

data: [DONE]
```

### Optional: Artifact Endpoints (for large files)

```http
# Upload
POST http://localhost:4000/artifact
Content-Type: audio/webm
X-Original-Filename: recording.webm
Body: [binary data]

Response: { "artifactId": "unique-id-123" }

# Download
GET http://localhost:4000/artifact/unique-id-123
Response: [binary data]
```

If artifact endpoints are not implemented:
- UI will store all files as data URLs in localStorage
- May hit quota limits with large files faster
- Everything else works normally

## Verify It's Working

### Browser Console

Open DevTools (F12) and check for:

```
Initializing AgentFlow UI...
Creating worker conversation from /static/js/workers/conversationWorker.js
Creating worker storage from /static/js/workers/storageWorker.js
Creating worker message from /static/js/workers/messageWorker.js
Worker conversation is ready
Worker storage is ready
Worker message is ready
All workers initialized successfully
Loaded 0 conversations
AgentFlow UI initialized
```

### Network Tab

After sending a message, you should see:
- `POST http://localhost:4000/v1/chat/completions`
- Type: `eventsource` or `fetch`
- Status: `200 OK`

### Common Issues

**❌ "Failed to fetch"**
- API server not running on port 4000
- CORS not configured on API server
- Firewall blocking connection

**❌ "Workers not initialized"**
- Serving from `file://` instead of `http://`
- Use the start script or any HTTP server

**❌ "Storage quota exceeded"**
- Too many large files
- UI automatically falls back to reduced data mode
- Export conversations and clear browser data

## Test Features

### 1. Basic Chat
1. Type: "What is 2+2?"
2. Press Enter
3. See streaming response

### 2. Audio Recording
1. Click 🎤 microphone button
2. Grant permission
3. Speak for a few seconds
4. Click ⏹️ stop
5. File appears in preview
6. Click Send

### 3. File Attachment
1. Click 📎 attach button
2. Select an image < 100KB
3. See preview with file size
4. Click Send

### 4. Large File (Artifact)
1. Attach image > 25KB
2. See "SERVER" badge (if artifact endpoint available)
3. Or see normal preview (if not available)

### 5. Conversation Management
1. Click ☰ menu
2. Click "+ New Chat"
3. Send a message
4. Switch back to first conversation
5. Click 🗑️ to delete second conversation

## Development Mode

The UI is now configured for:
- **API Server**: `http://localhost:4000`
- **UI Server**: `http://localhost:8080`
- **Artifact Server**: `http://localhost:4000/artifact` (optional)

No build process needed - it's pure HTML/CSS/JavaScript!

## Next Steps

Once basic functionality works:
1. Test audio recording with different sources
2. Test file attachments of various sizes
3. Create multiple conversations
4. Test export/import
5. Try on mobile device (use your local IP)

## Mobile Testing

To test on mobile device on same network:

```bash
# Find your local IP
ifconfig | grep "inet " | grep -v 127.0.0.1

# Start server
./start.sh

# On mobile browser, visit:
http://YOUR_LOCAL_IP:8080/index.html
```

## Troubleshooting

### API Server Check

```bash
# Test if API server is running
curl http://localhost:4000/v1/models

# Test chat endpoint
curl -X POST http://localhost:4000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "test",
    "messages": [{"role": "user", "content": "hi"}],
    "stream": true
  }'
```

### CORS Issues

If you see CORS errors in browser console, your API server needs these headers:

```
Access-Control-Allow-Origin: http://localhost:8080
Access-Control-Allow-Methods: GET, POST, OPTIONS
Access-Control-Allow-Headers: Content-Type, X-Original-Filename
```

For development, you can allow all origins:
```
Access-Control-Allow-Origin: *
```

### Check Worker Loading

If workers fail to initialize, check:

```bash
# Should return JavaScript code
curl http://localhost:8080/static/js/workers/conversationWorker.js
curl http://localhost:8080/static/js/workers/storageWorker.js
curl http://localhost:8080/static/js/workers/messageWorker.js
```

## Ready to Use! 🚀

The UI is now configured and ready to connect to your API server at `http://localhost:4000`.

Just run `./start.sh` and start chatting!
