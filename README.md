# AgentFlow UI

A modern, production-ready web interface for interacting with AI agents, featuring Google Drive integration, real-time audio visualization, and an elegant user experience built with the OCTO color system.

![AgentFlow UI](https://img.shields.io/badge/status-production-green)
![License](https://img.shields.io/badge/license-MIT-blue)

## Features

### 🚀 Core Functionality
- **Real-time Chat Interface** - Streaming responses from OpenAI-compatible APIs
- **Google Drive Sync** - Seamless conversation backup and restore with online/offline modes
- **Audio Recording** - Three modes (Microphone, System Audio, Mixed) with real-time visualization
- **File Attachments** - Support for images, PDFs, and audio files with smart storage
- **Conversation Management** - Search, filter, pin, rename, duplicate, and organize chats
- **Export to Google Docs** - Native markdown conversion with one-click export
- **Toast Notifications** - Non-intrusive notifications with clickable links

### 🎨 User Experience
- **OCTO Color System** - Professional navy blue (#0E2356) and turquoise (#00D2DD) branding
- **Audio Visualization** - Real-time 16-bar frequency equalizer during recording
- **Keyboard Shortcuts** - Cmd/Ctrl+B (toggle menu), K (search), N (new chat), Escape (close)
- **Mobile Optimized** - Responsive design with auto-fold menu and touch-friendly controls
- **Collapsible Sections** - System prompt and menu sections with state persistence
- **Conversation Grouping** - Organized by Today, Yesterday, This Week, Older

### 💾 Storage & Sync
- **Hybrid Storage** - IndexedDB for local caching + Google Drive for cloud backup
- **Automatic Sync** - Queue-based sync system with conflict resolution (last modified wins)
- **Artifact Management** - Large files (images, audio, PDFs) stored on Google Drive with `gdrive://` references
- **Offline Support** - Full functionality without Google Drive connection
- **Data Optimization** - Base64 caching for instant display, `gdrive://` storage for minimal footprint

## Project Structure

```
agentflowui/
├── README.md                        # This file
├── index.html                       # Main HTML page
│
├── static/
│   ├── css/
│   │   └── styles.css              # OCTO color system styles
│   │
│   └── js/
│       ├── chat.js                 # Main ChatUI class (~2700 lines)
│       ├── config.js               # Configuration constants
│       ├── googleDriveAuth.js      # OAuth2 authentication
│       ├── googleDriveStorage.js   # Google Drive API integration
│       ├── storageManager.js       # Hybrid storage orchestration
│       ├── workerManager.js        # Web Worker management
│       │
│       └── workers/
│           ├── conversationWorker.js  # API preparation, stats
│           ├── storageWorker.js       # Data optimization
│           └── messageWorker.js       # Export, markdown processing
```

## Quick Start

### Prerequisites

- A compatible API server (OpenAI-compatible `/v1/chat/completions` endpoint)
- Modern web browser (Chrome 90+, Firefox 88+, Safari 14+)
- Google Drive API credentials (optional, for cloud sync)

### 1. Configuration

Edit `index.html` to set your API server URL:

```javascript
window.AGENTFLOW_BASE_URL = 'http://localhost:4000';
```

### 2. Google Drive Setup (Optional)

To enable cloud sync:

1. Create a Google Cloud Project at https://console.cloud.google.com
2. Enable the Google Drive API
3. Create OAuth 2.0 credentials (Web application)
4. Add authorized redirect URI: `http://localhost:8000` (or your domain)
5. Update `static/js/config.js` with your credentials:

```javascript
const GOOGLE_CONFIG = {
    clientId: 'YOUR_CLIENT_ID.apps.googleusercontent.com',
    apiKey: 'YOUR_API_KEY',
    discoveryDocs: ['https://www.googleapis.com/discovery/v1/apis/drive/v3/rest'],
    scopes: 'https://www.googleapis.com/auth/drive.appdata https://www.googleapis.com/auth/drive.file'
};
```

### 3. Run

Serve the application with any static file server:

```bash
# Python
python3 -m http.server 8000

# Node.js
npx serve .

# Go
go run github.com/shurcooL/goexec@latest 'http.ListenAndServe(":8000", http.FileServer(http.Dir(".")))'
```

Navigate to `http://localhost:8000`

## Features Guide

### Google Drive Sync

**Connection States:**
- 🔴 **Offline** - Click to connect to Google Drive
- 🟢 **Online** - Connected, auto-sync enabled (every 5 minutes)
- 🔵 **Syncing** - Uploading/downloading conversations
- ⚪ **Initializing** - Connecting to Google Drive on startup

**Sync Freshness Indicator:**
- Green: Synced within 30 seconds
- Orange: Not synced for 30-60 seconds
- Red: Not synced for 1+ minute

**Click Actions:**
- Offline → Connect to Google Drive
- Online → Options menu (Sync Now / Disconnect)

**How it works:**
1. Conversations stored in IndexedDB for instant local access
2. Changes queued for Google Drive sync
3. Automatic bidirectional sync (last modified wins)
4. Large files (images, audio, PDFs) stored on Google Drive
5. Local base64 cache for instant display

### Audio Recording

**Three Modes:**

1. **Microphone** - Standard voice recording with noise suppression
   - Ideal for: Voice messages, dictation
   - Quality: Enhanced (echo cancellation, auto gain)

2. **System Audio** - Capture desktop/application audio
   - Ideal for: Screen recordings, music, videos
   - Requires: Screen sharing permission
   - Note: Browser shows video picker, only audio is recorded

3. **Mic + System** - Mixed audio using Web Audio API
   - Ideal for: Tutorial recordings, game commentary
   - Mix: 70% microphone + 80% system audio
   - Fallback: Microphone only if system audio unavailable

**Audio Visualization:**
- Real-time 16-bar frequency equalizer
- Turquoise gradient (#00D2DD → white)
- 60fps smooth animation
- Reacts to voice/music frequencies

**Recording Workflow:**
1. Select audio source from dropdown
2. Click 🔴 Record button
3. Click ⏺️ Segment button to create lap (optional)
4. Click ⏹️ Stop to finish and save

**Storage Strategy:**
- Recordings uploaded to Google Drive during capture
- Periodic uploads every 30 seconds for long recordings
- Stored as `gdrive://FILE_ID` references
- Downloaded once per conversation load and cached as base64

### File Attachments

**Supported Types:**
- **Images**: All formats (PNG, JPEG, GIF, WebP, SVG, etc.)
- **PDFs**: Documents for analysis
- **Audio**: WebM, MP3, WAV, etc.

**Upload Methods:**
- Click 📎 Attach button
- Select multiple files at once

**Storage:**
- Files uploaded to Google Drive in background
- Local preview available instantly
- Thumbnail preview for images (60x60px)
- `gdrive://` references in conversation data
- Badge indicators: GDRIVE (uploaded), UPLOADING (in progress), TEMP (offline)

### Conversation Management

**Features:**
- **Search** - Filter by title or message content (Cmd/Ctrl+K)
- **Pin** - Keep important conversations at top
- **Rename** - Edit conversation titles
- **Duplicate** - Copy conversations with all messages
- **Delete** - Remove conversations (with confirmation)
- **Grouping** - Automatic organization by date

**Date Groups:**
- Today
- Yesterday
- This Week
- Older

**Metadata Displayed:**
- Message count
- Last modified time (relative: "5m ago", "2h ago")
- Message preview (first 60 characters)

### Export Options

**Export to Markdown (Local):**
- Download as `.md` file
- Full conversation history
- Timestamps and metadata
- Code blocks preserved
- Images/audio noted as attachments

**Export to Google Docs:**
- One-click creation
- Native markdown → Google Docs conversion
- Automatic formatting
- Clickable link in toast notification
- Stored in Google Drive "AgentFlow" folder

**Import:**
- Supports `.json`, `.md`, `.txt` files
- Preserves message structure
- Automatically generates conversation ID

### Audio Playback

**Controls:**
- ▶️ Play/Pause button with icon toggle
- ⬇️ Download button (saves as `.webm` file)
- Only one audio plays at a time (auto-stops others)
- Visual playback state indicator

**Display:**
- Turquoise icon (48x48px)
- "Audio Recording" label
- Play and Download actions
- Error handling with notifications

## Architecture

### Storage System

**Three-Layer Architecture:**

```
┌─────────────────────────────────────────┐
│           ChatUI (Main App)             │
└──────────────────┬──────────────────────┘
                   │
┌──────────────────▼──────────────────────┐
│        StorageManager (Hybrid)          │
│  - IndexedDB (local cache)              │
│  - Google Drive (cloud sync)            │
│  - Sync queue management                │
└──────────────────┬──────────────────────┘
                   │
        ┌──────────┴──────────┐
        │                     │
┌───────▼─────────┐  ┌───────▼──────────┐
│   IndexedDB     │  │  Google Drive    │
│  - Conversations│  │  - Conversations │
│  - Artifacts    │  │  - Large files   │
│  - Sync queue   │  │  - Auto-backup   │
│  - Metadata     │  │                  │
└─────────────────┘  └──────────────────┘
```

**Storage Objects:**

1. **Conversations** - Chat history and metadata
   ```javascript
   {
     id: "conv_1234567890",
     title: "Example Conversation",
     createdAt: 1733335200000,
     lastModified: 1733338800000,
     messages: [...],
     systemPrompt: "You are a helpful assistant.",
     pinned: false
   }
   ```

2. **Artifacts** - Large file references
   ```javascript
   {
     type: "image_url",
     image_url: {
       url: "data:image/png;base64,...",  // Cached for display
       _gdriveUrl: "gdrive://FILE_ID"     // Original reference
     }
   }
   ```

### Sync Strategy

**Queue-Based Sync:**
1. User makes change (edit message, add conversation)
2. Change saved to IndexedDB immediately
3. Change queued for Google Drive sync
4. Queue processed after 100ms delay (non-blocking)
5. Auto-sync every 5 minutes

**Conflict Resolution:**
- Last modified timestamp wins
- Full bidirectional sync on connect
- Local changes preserved during offline mode
- Merged on reconnect

### Web Workers

**Purpose:** Offload heavy processing from main thread

**ConversationWorker:**
- Prepare messages for API (add system prompt, format)
- Calculate conversation statistics

**StorageWorker:**
- Create reduced conversations (data optimization)
- Calculate storage usage

**MessageWorker:**
- Export conversations (JSON, Markdown)
- Process message content

**Fallback:** App works without workers (synchronous processing)

### Google Drive Integration

**API Endpoints Used:**
- `POST /upload/drive/v3/files` - Upload files (multipart)
- `GET /drive/v3/files/{fileId}` - Download files
- `GET /drive/v3/files` - List conversations
- `DELETE /drive/v3/files/{fileId}` - Delete conversations

**File Organization:**
- App folder: `AgentFlow` (created in user's Drive)
- Conversations: JSON files with conversation data
- Artifacts: Uploaded as separate files (images, audio, PDFs)

**Authentication:**
- OAuth 2.0 with PKCE flow
- Tokens stored in localStorage
- Auto-refresh on expiry
- Login popup window (closed after success)

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
      "content": "You are a helpful assistant.\nCurrent time is 2024-12-05 12:00"
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

data: {"choices":[{"index":0,"delta":{"content":" there"}}]}

data: {"choices":[{"index":0,"delta":{"content":"!"}}]}

data: [DONE]
```

### Multimodal Messages

**Images:**
```json
{
  "role": "user",
  "content": [
    { "type": "text", "text": "What's in this image?" },
    {
      "type": "image_url",
      "image_url": { "url": "data:image/png;base64,iVBORw0..." }
    }
  ]
}
```

**Audio:**
```json
{
  "role": "user",
  "content": [
    {
      "type": "audio",
      "audio": { "data": "data:audio/webm;base64,GkXfo..." }
    }
  ]
}
```

**PDFs:**
```json
{
  "role": "user",
  "content": [
    { "type": "text", "text": "Analyze this document" },
    {
      "type": "file",
      "file": {
        "file_data": "data:application/pdf;base64,JVBERi0...",
        "filename": "document.pdf"
      }
    }
  ]
}
```

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd/Ctrl + B` | Toggle side menu |
| `Cmd/Ctrl + K` | Focus conversation search |
| `Cmd/Ctrl + N` | Create new chat |
| `Escape` | Close all dropdowns (also collapses menu on mobile) |
| `Enter` | Send message |
| `Shift + Enter` | New line in message |
| `Ctrl/Cmd + Enter` | Save edit (in edit mode) |

## Browser Compatibility

**Minimum Requirements:**
- Chrome 90+ / Edge 90+
- Firefox 88+
- Safari 14+

**Required APIs:**
- Fetch API (for HTTP requests)
- ReadableStream (for SSE streaming)
- MediaRecorder API (for audio recording)
- Web Audio API (for audio visualization and mixing)
- IndexedDB (for local storage)
- Web Workers (optional, graceful degradation)

**Recommended:**
- File System Access API (for downloads)
- Clipboard API (for future paste support)

## Development

### Project Setup

```bash
# Clone repository
git clone https://github.com/owulveryck/agentflowui.git
cd agentflowui

# No build step required - pure HTML/CSS/JavaScript
# Just serve with any static file server
python3 -m http.server 8000
```

### Code Style

- **ES6+** - Modern JavaScript (async/await, arrow functions, classes)
- **No frameworks** - Pure vanilla JavaScript
- **Web Standards** - Uses native browser APIs
- **Progressive Enhancement** - Works without workers, without Google Drive

### Adding Features

**Example: Add new notification type**

1. Update `showNotification()` in `chat.js`:
```javascript
showNotification(message, type = 'info', options = {}) {
    // type can be: 'success', 'error', 'warning', 'info', 'custom'
    const icons = {
        success: 'check_circle',
        error: 'error',
        warning: 'warning',
        info: 'info',
        custom: 'star'  // Add new type
    };
    // ...
}
```

2. Add CSS in `styles.css`:
```css
.notification-toast.custom {
    border-left-color: var(--turquoise);
}

.notification-toast.custom .notification-icon .material-icons {
    color: var(--turquoise);
}
```

### Testing Checklist

- [ ] Create new conversation
- [ ] Send text message
- [ ] Attach image (PNG/JPEG)
- [ ] Attach PDF
- [ ] Record microphone audio
- [ ] Record system audio
- [ ] Record mixed audio (mic + system)
- [ ] Create audio segment (lap)
- [ ] Play audio in message
- [ ] Download audio file
- [ ] Export conversation to Markdown
- [ ] Export conversation to Google Docs
- [ ] Import conversation from JSON
- [ ] Search conversations
- [ ] Pin/unpin conversation
- [ ] Rename conversation
- [ ] Duplicate conversation
- [ ] Delete conversation
- [ ] Connect to Google Drive
- [ ] Sync conversations
- [ ] Disconnect from Google Drive
- [ ] Test keyboard shortcuts
- [ ] Test on mobile device
- [ ] Test with slow network
- [ ] Test offline mode

## Troubleshooting

### Google Drive Sync Issues

**Symptoms:** "Sync error" notification, red indicator

**Common Causes:**
1. **Token expired** - Disconnect and reconnect
2. **Network issue** - Check internet connection
3. **API quota exceeded** - Wait and retry (unlikely with normal use)
4. **CORS error** - Check redirect URI configuration

**Solution:**
- Click sync indicator → Disconnect
- Click sync indicator → Connect
- Check browser console for detailed errors

### Audio Recording Fails

**1. System audio not working**

**Error:** `NotSupportedError` or "No system audio available"

**Cause:** Video must be enabled for `getDisplayMedia()` to capture system audio

**Solution:**
- Select screen/window in browser picker
- Grant audio permission
- Video is stopped immediately (not recorded)

**2. Mixed audio fails**

**Behavior:** Falls back to microphone only

**Cause:** System audio unavailable or Web Audio API error

**Solution:**
- Check browser console for errors
- Try "System Audio" mode alone first
- Update browser to latest version

**3. Permission denied**

**Error:** "Recording failed: Permission denied"

**Solution:**
- Check browser address bar for permission prompt
- Reset permissions in browser settings
- Try incognito/private mode

### Audio Visualization Not Showing

**Symptoms:** Bars not moving during recording

**Checks:**
1. Ensure canvas element exists: `document.getElementById('audio-visualizer')`
2. Check browser console for Web Audio API errors
3. Verify audio stream has tracks: `audioStream.getTracks().length > 0`

**Solution:**
- Refresh page
- Check browser supports Web Audio API
- Verify recording actually started (red bar visible)

### Storage Quota Exceeded

**Symptoms:** Warning notification, conversations not saving

**Automatic Handling:**
- App uploads large files to Google Drive
- Stores only `gdrive://` references locally
- IndexedDB used for unlimited storage

**Manual Fix:**
- Connect to Google Drive (converts storage to cloud)
- Delete old conversations
- Export conversations before deleting

### Export to Google Docs Fails

**Error:** "Please connect to Google Drive first"

**Solution:** Click sync indicator → Connect to Google Drive

**Error:** "Failed to create Google Doc"

**Causes:**
- Network issue
- Google Drive API quota exceeded (rare)
- Permission issue

**Solution:**
- Check internet connection
- Try export to Markdown (local) instead
- Retry after a few minutes

## Performance

### Storage Efficiency

**Without Google Drive:**
- 50 conversations × 2 images × 500KB = 50MB
- ❌ IndexedDB quota issues possible

**With Google Drive:**
- Small metadata in IndexedDB: ~500KB
- Large files on Google Drive: unlimited
- Base64 cache in memory: ~10MB
- ✅ No quota issues

### Network Usage

**Initial Load:**
- HTML: ~10KB
- CSS: ~25KB
- JavaScript: ~80KB
- Total: ~115KB (uncompressed)

**Per Conversation Sync:**
- Upload: ~2-10KB (JSON metadata)
- Download: ~2-10KB (JSON metadata)
- Images/audio downloaded on demand: 100KB-5MB

**Bandwidth Optimization:**
- Artifacts downloaded once per session
- Cached in memory as base64
- No repeated downloads during conversation

### Rendering Performance

**Audio Visualization:**
- 60fps using `requestAnimationFrame`
- Canvas rendering: ~2ms per frame
- Minimal CPU usage (<5%)

**Message Rendering:**
- Markdown parsing: ~1-5ms per message
- Mermaid diagrams: ~50-100ms (first render)
- Syntax highlighting: ~10-20ms per code block

## Security

### Data Privacy

- **Local-first** - All data stored locally in IndexedDB
- **Optional Cloud** - Google Drive sync is opt-in
- **No analytics** - Zero tracking or telemetry
- **No server** - Direct API communication only

### Google Drive Security

- **OAuth 2.0** - Industry-standard authentication
- **Limited scope** - Only app folder access (`drive.appdata`)
- **User-controlled** - Can disconnect anytime
- **Encrypted** - HTTPS for all Google Drive communication

### API Security

- **CORS required** - API server must allow origin
- **No credentials** - No API keys stored in client
- **Direct connection** - No proxy server

## License

MIT License - See [LICENSE](./LICENSE) file for details

## Contributing

Contributions welcome! Please:

1. Fork the repository
2. Create feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open Pull Request

## Support

- **Issues:** https://github.com/owulveryck/agentflowui/issues
- **Discussions:** https://github.com/owulveryck/agentflowui/discussions

## Acknowledgments

- OCTO brand colors and design system
- Google Drive API for cloud storage
- Material Icons for UI iconography
- Marked.js for markdown rendering
- Mermaid for diagram rendering
