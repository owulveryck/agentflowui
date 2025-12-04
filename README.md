# AgentFlow UI - MVP

A modern, mobile-optimized web interface for interacting with AI agents, featuring advanced audio recording, multi-tier storage, and Web Workers for optimal performance.

## Features

### Core Functionality
- ✅ **Real-time Chat Interface** - Streaming responses from AI models
- ✅ **Multi-tier Storage** - localStorage → reduced data → IndexedDB → sessionStorage → download
- ✅ **Web Workers Architecture** - Non-blocking data processing for smooth UX
- ✅ **Audio Recording** - Three modes: Microphone, System Audio, Mixed (Mic + System)
- ✅ **File Attachments** - Images, PDFs, and audio files with smart artifact storage
- ✅ **Conversation Management** - Create, load, delete, export, import conversations
- ✅ **OCTO Color System** - Professional branding with accessibility-compliant colors

### Technical Highlights
- **25KB Threshold**: Files larger than 25KB automatically stored on artifact server
- **500KB/30s Audio Threshold**: Large recordings stored server-side to prevent quota issues
- **Segment Recording**: Create multiple audio segments in one session (lap feature)
- **Graceful Degradation**: Works without workers, without artifact server
- **Mobile-Optimized**: Responsive design with touch-friendly controls

## Project Structure

```
agentflowui/
├── ARCHITECTURE.md              # Detailed architecture documentation
├── SPEC_UI.md                   # Complete UI specification
├── README.md                    # This file
│
├── static/
│   ├── css/
│   │   └── styles.css          # OCTO color system styles
│   │
│   └── js/
│       ├── chat.js             # Main ChatUI class (~1200 lines)
│       ├── workerManager.js    # Worker orchestration
│       │
│       └── workers/
│           ├── conversationWorker.js  # API preparation, stats
│           ├── storageWorker.js       # Data reduction, optimization
│           └── messageWorker.js       # Export, search, processing
│
└── templates/
    └── chat-ui.html.tmpl       # Main HTML template
```

## Quick Start

### 1. Setup

The MVP is a static web application that requires:
- A compatible API server (OpenAI-compatible `/v1/chat/completions`)
- Optional: Artifact storage server for large files

### 2. Configuration

Edit `chat-ui.html.tmpl` to set the API base URL:

```javascript
window.AGENTFLOW_BASE_URL = 'http://localhost:4000'; // Your API server
```

Or use template variables:
- `{{.BaseURL}}` - Base URL for static assets
- `{{.APIURL}}` - API server URL

### 3. Run

Serve the application with any static file server:

```bash
# Python
python3 -m http.server 8000

# Node.js
npx serve .

# Go
go run -m http.FileServer
```

Then navigate to `http://localhost:8000/templates/chat-ui.html.tmpl`

## Usage Guide

### Starting a Conversation

1. Click "New Chat" in the side menu
2. Type your message or attach files
3. Press Enter or click Send
4. Watch the streaming response appear

### Audio Recording

**Three Modes:**
- **Microphone Only**: Standard voice recording with noise suppression
- **System Audio**: Capture desktop/application audio (requires screen sharing permission)
- **Mic + System**: Mixed audio using Web Audio API (70% mic, 80% system)

**Recording Workflow:**
1. Select audio source from dropdown
2. Click 🔴 to start recording
3. Click ⏺️ to create a segment (lap) while continuing to record
4. Click ⏹️ to stop and save

**Storage:**
- Recordings < 500KB or < 30s: Stored in localStorage as data URLs
- Recordings ≥ 500KB or ≥ 30s: Uploaded to artifact server

### File Attachments

**Supported Types:**
- Images: `image/*` (JPEG, PNG, GIF, WebP, etc.)
- PDFs: `application/pdf`
- Audio: `audio/*` (WebM, MP3, WAV, etc.)

**Storage:**
- Files < 25KB: Stored in localStorage
- Files ≥ 25KB: Uploaded to artifact server

**Methods:**
- Click 📎 attachment button
- Drag and drop files
- Paste images from clipboard (future)

### Conversation Management

**Export:**
- Click "Export" to download conversation as Markdown
- Format includes timestamps, messages, and metadata

**Import:**
- Click "Import" to load a conversation from JSON
- Supports conversations exported from AgentFlow

**Delete:**
- Click 🗑️ trash icon next to conversation
- Confirmation required before deletion

### System Prompt

Edit the system prompt in the side menu to customize AI behavior:

```
You are a helpful assistant.
Current time is 2024-12-04 12:00
```

Changes apply to new messages in the current conversation.

## Architecture Overview

### Web Workers

**ConversationWorker:**
- Prepare messages for API (add system prompt, format multimodal content)
- Calculate conversation statistics (total size, message count)

**StorageWorker:**
- Create reduced conversations (strip large data, truncate content to 1000 chars)
- Calculate storage usage (total size, averages)

**MessageWorker:**
- Export conversations (JSON, Markdown formats)
- Process message content (detect code blocks, attachments)

### Storage Strategy

**5-Tier Fallback:**

```
1. localStorage (primary)
   ↓ QuotaExceededError?
2. localStorage with reduced data
   ↓ Still fails?
3. IndexedDB
   ↓ Not available?
4. sessionStorage
   ↓ 3+ consecutive failures?
5. Auto-download backup JSON
```

**Data Reduction:**
- Truncate message content to 1000 characters
- Remove attachments > 10KB
- Keep only conversation metadata and structure

### Artifact System

**Server Endpoints:**

```http
# Upload
POST /artifact
Content-Type: {file MIME type}
X-Original-Filename: {filename}
Body: {binary data}

Response: { "artifactId": "unique-id" }

# Retrieve
GET /artifact/{artifactId}
Response: {binary data}
```

**Reference Format:**
- Stored in localStorage: `artifact:abc123`
- Resolved before sending to API: `data:audio/webm;base64,...`

## API Integration

### Expected API Format

```http
POST /v1/chat/completions
Content-Type: application/json

{
  "model": "gemini-2.0-flash",
  "messages": [
    {
      "role": "system",
      "content": "You are a helpful assistant."
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

### Streaming Response (SSE)

```
data: {"choices":[{"index":0,"delta":{"content":"Hello"}}]}

data: {"choices":[{"index":0,"delta":{"content":"!"}}]}

data: [DONE]
```

### Multimodal Messages

```json
{
  "role": "user",
  "content": [
    { "type": "text", "text": "What's in this image?" },
    {
      "type": "image_url",
      "image_url": { "url": "data:image/png;base64,..." }
    }
  ]
}
```

## Browser Compatibility

**Minimum Requirements:**
- Chrome 90+ / Edge 90+
- Firefox 88+
- Safari 14+

**Required APIs:**
- Fetch API
- ReadableStream (for SSE)
- Web Workers (optional, graceful degradation)
- MediaRecorder API (for audio recording)
- Web Audio API (for mixed audio mode)
- IndexedDB (for fallback storage)

## Performance Considerations

### Worker Benefits

- **Main thread blocking reduced by 30-60%**
- JSON serialization/parsing offloaded to workers
- Smooth UI during heavy data processing
- No freezing during save operations

### Storage Optimization

**Without Optimization:**
- 50 conversations × 2 images each × 500KB = 50MB
- ❌ Quota exceeded immediately

**With Artifact Storage (25KB threshold):**
- Small images in localStorage: ~200KB
- Large images on server (references only): ~2KB
- ✅ Total localStorage: ~202KB

**With Worker Optimization + Artifacts:**
- Reduced messages: ~100KB
- Artifact references: ~2KB
- ✅✅ Total localStorage: ~102KB

### Audio Recording Performance

**Stream Reuse:**
- No repeated permission requests for segments
- Consistent quality across segments
- Reduced latency between recordings

**Size Estimates (Opus 128kbps):**
- 30 seconds: ~480KB → Artifact storage
- 1 minute: ~960KB → Artifact storage
- 2 minutes: ~1.92MB → Artifact storage
- 5 minutes: ~4.80MB → Artifact storage

## Troubleshooting

### Workers Not Initializing

**Symptoms:** Console shows "Using fallback mode"

**Causes:**
- Worker scripts not accessible (CORS, path issues)
- Browser doesn't support Web Workers
- Content Security Policy blocking workers

**Solution:**
- Check browser console for errors
- Verify worker script paths are correct
- App continues to work in fallback mode (synchronous processing)

### Storage Quota Exceeded

**Symptoms:** Warning notification "Storage quota exceeded"

**Automatic Handling:**
1. App switches to reduced data mode
2. Large attachments stripped from localStorage
3. Falls back to IndexedDB if available
4. After 3 failures, offers download backup

**Manual Fix:**
- Export important conversations
- Delete old conversations
- Clear browser data for the site
- Import conversations back

### Artifact Server Unavailable

**Symptoms:** All files stored as data URLs, potential quota issues

**Detection:** 2-second timeout check at startup

**Fallback Behavior:**
- All files stored in localStorage regardless of size
- Warning shown to user
- App continues to function

**Fix:**
- Check artifact server is running
- Verify `AGENTFLOW_BASE_URL` is correct
- Check network/CORS configuration

### Audio Recording Fails

**Common Issues:**

1. **No permission granted**
   - Browser prompts for microphone/screen access
   - User must approve

2. **System audio not working**
   - Requires screen sharing permission
   - Not supported on all browsers/OS

3. **Mixed audio fails**
   - Falls back to microphone only
   - Check browser console for Web Audio API errors

## Development

### Adding New Features

**Example: Add new export format**

1. Add worker method in `messageWorker.js`:
```javascript
exportAsHTML(conversation) {
    // Implementation
    return {
        success: true,
        data: { content, filename, mimeType }
    };
}
```

2. Add WorkerManager proxy in `workerManager.js`:
```javascript
async exportConversationAsHTML(conversation) {
    return this.sendToWorker('message', 'exportAsHTML', conversation);
}
```

3. Use in ChatUI in `chat.js`:
```javascript
const result = await this.workerManager.exportConversationAsHTML(conversation);
this.downloadFile(result.data.content, result.data.filename, result.data.mimeType);
```

### Testing

**Manual Testing Checklist:**
- [ ] Create new conversation
- [ ] Send text message
- [ ] Attach image < 25KB
- [ ] Attach image > 25KB (verify artifact upload)
- [ ] Record audio < 30s
- [ ] Record audio > 30s (verify artifact upload)
- [ ] Create audio segment (lap)
- [ ] Export conversation
- [ ] Import conversation
- [ ] Delete conversation
- [ ] Test on mobile device
- [ ] Test with workers disabled
- [ ] Test with artifact server down
- [ ] Test localStorage quota exceeded

## Future Enhancements

**Planned Features:**
- [ ] Search across conversations
- [ ] Tags for organization
- [ ] Light/dark mode toggle
- [ ] Keyboard shortcuts
- [ ] Voice-to-text (real-time)
- [ ] Collaborative features
- [ ] Tool call visualization
- [ ] Offline mode with Service Workers

## License

MIT License - See LICENSE file for details

## Documentation

- [ARCHITECTURE.md](./ARCHITECTURE.md) - Detailed architecture documentation
- [SPEC_UI.md](./SPEC_UI.md) - Complete UI specification with API details

## Support

For issues, questions, or contributions, please visit the project repository.
