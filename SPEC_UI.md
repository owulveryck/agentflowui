# AgentFlow UI Specification

This document provides a comprehensive specification of the AgentFlow web-based chat interface, including API interactions, event mechanisms, and all available features.

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [API Endpoints](#api-endpoints)
- [Server-Sent Events (SSE) Mechanism](#server-sent-events-sse-mechanism)
- [Core Features](#core-features)
  - [Recording Feature](#recording-feature)
  - [Side Menu](#side-menu)
  - [Conversation UI](#conversation-ui)
  - [Model and Tools Selection](#model-and-tools-selection)
  - [File Attachments](#file-attachments)
- [Storage Architecture](#storage-architecture)
- [Web Workers](#web-workers)
- [Code Organization](#code-organization)

---

## Architecture Overview

**AgentFlow** is a modern, mobile-optimized web application for interacting with agentic systems. It features:

- **Server-side**: Go-based OpenAI-compatible API server with SSE streaming
- **Client-side**: Vanilla JavaScript with Web Workers for performance optimization
- **Template Engine**: Go templates with dynamic `BaseURL` configuration
- **Storage**: Multi-tiered approach (localStorage, IndexedDB, sessionStorage, download fallback)
- **Artifact Storage**: Server-side storage for large files to prevent localStorage quota issues

The UI can be served in two modes:
1. **Embedded**: Served from the main `openaiserver` at `/ui`
2. **Standalone**: Separate `ui` server with configurable API URL

---

## API Endpoints

### Base Configuration

The API base URL is injected into the template via `window.AGENTFLOW_BASE_URL`:
- **Embedded mode**: Empty string (same server)
- **Standalone mode**: Points to separate API server (e.g., `http://localhost:4000`)

### 1. Chat Completions (Streaming)

**Endpoint**: `POST /v1/chat/completions`

**Request Body**:
```json
{
  "model": "gemini-2.0-flash",
  "messages": [
    {
      "role": "system",
      "content": "You are a helpful assistant.\nCurrent time is {{now | formatTimeInLocation \"Europe/Paris\" \"2006-01-02 15:04\"}}"
    },
    {
      "role": "user",
      "content": "Hello!"
    }
  ],
  "temperature": 0.7,
  "max_tokens": 2000,
  "stream": true,
  "tools": [] // Optional: array of tool definitions
}
```

**Message Content Types**:
Messages can be:
- **Text-only**: `content: "string"`
- **Multimodal**: `content: [{ type: "text", text: "..." }, { type: "image_url", image_url: { url: "data:..." } }]`

**Multimodal Content Item Types**:
- `text`: Text content (`{ type: "text", text: "..." }`)
- `image_url`: Images (`{ type: "image_url", image_url: { url: "data:image/..." } }`)
- `file`: PDFs and other files (`{ type: "file", file: { file_data: "data:...", filename: "..." } }`)
- `audio`: Audio files (`{ type: "audio", audio: { data: "data:audio/..." } }`)
- `audio_artifact`: Server-stored audio (`{ type: "audio_artifact", audio_artifact: { artifactId: "...", filename: "...", formattedSize: "..." } }`)

**Response**: Server-Sent Events (SSE) stream with `Content-Type: text/event-stream`

**Headers**:
```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
Transfer-Encoding: chunked
```

### 2. List Models

**Endpoint**: `GET /v1/models`

**Response**:
```json
{
  "data": [
    {
      "id": "gemini-2.0-flash",
      "owned_by": "google",
      "created": 1234567890
    }
  ]
}
```

### 3. Get Model Details

**Endpoint**: `GET /v1/models/{modelId}`

**Response**:
```json
{
  "id": "gemini-2.0-flash",
  "owned_by": "google",
  "created": 1234567890
}
```

### 4. List Available Tools

**Endpoint**: `GET /v1/tools`

**Response**:
```json
[
  {
    "Name": "Bash",
    "Description": "Execute bash commands"
  },
  {
    "Name": "Edit",
    "Description": "Edit file contents"
  }
]
```

### 5. Artifact Storage (Large Files)

**Upload Artifact**:
- **Endpoint**: `POST /artifact`
- **Headers**:
  - `Content-Type`: File MIME type
  - `X-Original-Filename`: Original filename
- **Body**: Raw file data
- **Response**: `{ "artifactId": "unique-id" }`

**Retrieve Artifact**:
- **Endpoint**: `GET /artifact/{artifactId}`
- **Response**: Raw file data with appropriate `Content-Type`

**Usage**:
- Files > 25KB are automatically stored as artifacts
- Artifact references are stored in localStorage instead of base64 data
- Format: `artifact:{artifactId}` (e.g., `artifact:abc123`)

---

## Server-Sent Events (SSE) Mechanism

### Event Format

All SSE events are sent as:
```
data: {JSON_PAYLOAD}

```

The stream ends with:
```
data: [DONE]

```

### Event Types

The backend can emit different event types based on the `withAllEvents` flag:

#### 1. Chat Completion Chunks (Always Sent)

**Structure**:
```json
{
  "id": "chatcmpl-123",
  "object": "chat.completion.chunk",
  "created": 1234567890,
  "model": "gemini-2.0-flash",
  "choices": [
    {
      "index": 0,
      "delta": {
        "role": "assistant",
        "content": "Hello! "
      },
      "finish_reason": null
    }
  ]
}
```

**Finish Reasons**:
- `null`: Streaming in progress
- `"stop"`: Completed normally
- `"length"`: Max tokens reached
- `"error"`: Error occurred

#### 2. Tool Call Events (When `withAllEvents: true`)

**Structure**:
```json
{
  "event_type": "tool_call",
  "object": "tool_event",
  "tool_call": {
    "id": "call_abc123",
    "name": "Bash",
    "arguments": {
      "command": "ls -la"
    }
  }
}
```

**Client Behavior**:
- Creates a tool notification in the chat
- Shows a popup with tool execution status
- Popup remains until tool response is received

#### 3. Tool Response Events (When `withAllEvents: true`)

**Structure**:
```json
{
  "event_type": "tool_response",
  "object": "tool_event",
  "tool_response": {
    "id": "call_abc123",
    "name": "Bash",
    "response": "file1.txt\nfile2.txt",
    "error": null
  }
}
```

Or with error:
```json
{
  "event_type": "tool_response",
  "object": "tool_event",
  "tool_response": {
    "id": "call_abc123",
    "name": "Bash",
    "response": null,
    "error": "Command failed: permission denied"
  }
}
```

**Client Behavior**:
- Updates the matching tool popup (by `id`)
- Shows success (green) or error (red) state
- Auto-closes after 5.5 seconds

#### 4. Error Events (When `withAllEvents: true`)

**Structure**:
```json
{
  "event_type": "error",
  "object": "error_event",
  "error": {
    "message": "Failed to connect to MCP server",
    "severity": "error",
    "source": "mcp_client",
    "context": "Connection timeout after 30s"
  }
}
```

**Client Behavior**:
- Displays error notification in chat area
- Auto-hides after 10 seconds

### Client-Side Event Processing

The client processes SSE events in `handleStreamingResponse()`:

```javascript
// Parse SSE event
const parsed = JSON.parse(data);

// Route based on event_type
switch (parsed.event_type) {
  case 'tool_call':
    this.addToolNotification(parsed.tool_call.name, parsed);
    this.showToolCallPopup(parsed);
    break;

  case 'tool_response':
    this.updateToolResponsePopup(parsed);
    this.storeToolResponse(parsed);
    break;

  case 'error':
    this.showErrorNotification(parsed);
    break;

  default:
    // Regular chat completion chunks
    if (parsed.choices && parsed.choices[0]) {
      const delta = parsed.choices[0].delta;
      if (delta && delta.content) {
        // Stream content to UI
      }
    }
}
```

### Streaming Control

**Stop Streaming**:
- User clicks "Stop" button
- Sets `isStreaming = false`
- Calls `reader.cancel()` on the ReadableStream
- Flushes partial message with `*[stopped]*` indicator
- Closes all tool popups

**Stream Error Handling**:
- Connection errors show inline error in chat
- Quota exceeded errors trigger storage cleanup
- Network errors auto-retry once

---

## Core Features

### Recording Feature

The UI provides advanced audio recording capabilities with multiple sources.

#### Audio Sources

Three recording modes are available:

1. **Microphone Only**
   - Standard microphone capture
   - Echo cancellation, noise suppression, auto gain enabled
   - Ideal for voice input

2. **System Audio**
   - Captures system/desktop audio
   - Requires screen sharing permission (but video tracks are dropped)
   - Useful for recording system sounds

3. **Microphone + System Audio** (Mixed)
   - Combines both sources using Web Audio API
   - Creates mixed audio stream with volume balancing
   - Microphone: 70% volume, System: 80% volume
   - Falls back to microphone-only on error

#### Recording Workflow

**Start Recording**:
1. User selects audio source (persisted to `localStorage`)
2. Clicks record button
3. Permission request (if needed)
4. Audio stream acquired
5. MediaRecorder starts with Opus codec (fallback: WebM, MP4, WAV)
6. Timer starts, waveform animation displays

**Create Segment (Lap)**:
- Saves current recording as a separate audio file
- Automatically starts a new recording using the same stream
- Useful for creating multiple audio segments in one session
- Each segment is processed independently

**Stop Recording**:
- Stops MediaRecorder
- Processes accumulated audio chunks
- Creates Blob with appropriate MIME type
- Converts to file attachment

#### Storage Strategy for Recordings

Audio files are stored using a two-tier approach:

**Thresholds**:
- **Size**: 500KB
- **Duration**: 30 seconds

**Small recordings** (< 500KB or < 30s):
- Converted to base64 data URL
- Stored directly in message content

**Large recordings** (≥ 500KB or ≥ 30s):
- Uploaded to artifact storage via `POST /artifact`
- Artifact ID stored in message content
- Reference format: `artifact:{id}`
- Prevents localStorage quota issues

#### File Format Support

Supported formats (auto-detected):
- `audio/webm; codecs=opus` (preferred)
- `audio/webm` (fallback)
- `audio/mp4` (fallback)
- `audio/wav` (final fallback)

#### UI Elements

**Recording Controls**:
- **Record button**: Start recording
- **Stop button**: Stop and save recording
- **Segment button**: Create lap/segment while recording continues
- **Timer**: Shows elapsed time (MM:SS)
- **Waveform animation**: Visual feedback during recording

**Audio Source Selector**:
- Dropdown with three options
- Material icons for each source
- Persistent preference in localStorage

---

### Side Menu

The side menu provides conversation management and configuration options.

#### Header Section

**New Chat Button**:
- Creates a new conversation with unique ID (`conv_{timestamp}`)
- Initializes with empty messages array
- Uses current system prompt
- Reloads tools and unchecks all by default
- Auto-saves to localStorage

#### System Prompt Section

**Features**:
- **Textarea**: Multi-line system prompt editing
- **Template Support**: Go templates (e.g., `{{now | formatTimeInLocation "Europe/Paris" "2006-01-02 15:04"}}`)
- **Save Button**: Persists changes to current conversation
- **Reset Button**: Restores default system prompt
- **Auto-save**: Changes trigger conversation save

**Default System Prompt**:
```
You are a helpful assistant.
Current time is {{now | formatTimeInLocation "Europe/Paris" "2006-01-02 15:04"}}
```

#### Export/Import Section

**Export Conversation**:
- Generates markdown file with:
  - Conversation title and metadata
  - All messages (user/assistant roles with emojis)
  - Embedded images/files as base64 references
  - Model name in assistant headers
  - Timestamp in filename
- Format: `{title}_{date}.md`
- Images/audio use reference-style markdown

**Import Conversation**:
- Accepts `.md` or `.txt` files
- Parses markdown structure:
  - Extracts title, system prompt, metadata
  - Identifies user/assistant messages by headers (`## 👤 User`, `## 🧠 Assistant`)
  - Reconstructs multimodal content from embedded references
- Creates new conversation with imported data
- Auto-switches to imported conversation

**Cleanup Button**:
- Displays alert: "Cleanup functionality has been disabled"
- Originally designed for storage cleanup (now disabled per user request)
- Individual conversations can be deleted via trash icon

#### Conversations List

**Organization**:
- Grouped by date (Today, Yesterday, specific dates)
- Each date group can be folded/unfolded
- Groups start folded by default
- Date headers show formatted dates (e.g., "October 1st 2025")

**Conversation Item**:
- **Title**: Auto-generated from first message (up to 50 chars)
- **Active indicator**: Current conversation highlighted
- **Action buttons**:
  - **📋 Duplicate**: Creates a copy with "(Copy)" suffix
  - **✏️ Rename**: Prompt for new title
  - **🔄 Restore** (if stripped content exists): Restores from artifacts
  - **🗑️ Delete**: Confirms before removing

**Sorting**:
- Within each date group: Latest first (by `lastModified`)
- Date groups: Most recent date first

**Restore from Artifacts**:
- Appears when conversation has stripped content (large files removed to save space)
- Fetches artifact data and replaces placeholder content
- Shows progress notification
- Reports success/failure count

---

### Conversation UI

The main chat interface for message display and interaction.

#### Message Display

**Message Structure**:
- **User messages**: Right-aligned, blue gradient background
- **Assistant messages**: Left-aligned, gray background
- **Tool notifications**: Inline system notifications (yellow background)

**Content Rendering**:
- **Markdown support**: Full GFM with code blocks, lists, links, images
- **Syntax highlighting**: Prism.js for code blocks
- **Diagram support**: Mermaid.js for flowcharts, sequence diagrams, etc.
- **PlantUML support**: SVG diagrams from PlantUML server
- **Math rendering**: (if configured)

**Code Blocks**:
- Language label (e.g., "PYTHON", "JAVASCRIPT")
- Copy button inside block
- Syntax highlighting with dark theme
- Full content copying (uses `textContent` to avoid truncation)

**Mermaid Diagrams**:
- Rendered inline with proper styling
- "Save PNG" button for high-resolution export (2x scale)
- White background applied automatically
- Auto-rendering after streaming completes

**Attachments Display**:

1. **Images**:
   - Max 300x300px with rounded corners
   - File size badge (top-right)
   - Artifact indicator if stored on server

2. **PDFs**:
   - Red gradient card with icon
   - Filename, size, and download button
   - Visual file type indicator

3. **Audio**:
   - Inline audio player with controls
   - File size badge
   - Server storage indicator (green badge)
   - Supports WebM, MP3, WAV formats

4. **Stripped Content** (when data removed):
   - Placeholder with dashed border
   - Informational text about removal
   - Option to restore from artifacts

#### Message Actions

**Edit Button**:
- Replaces message content with textarea
- Shows existing attachments with remove buttons
- Allows adding new attachments (images, PDFs, audio)
- **Save**: Updates message and re-renders
- **Save & Restart from here**: Updates and regenerates assistant response
- **Cancel**: Reverts to original content

**Replay from here Button** (user messages only):
- Removes all messages after selected point
- Triggers new assistant response
- Useful for branching conversations

#### Text Selection and Copy

**Features**:
- Select any text in chat messages
- Floating "Copy" button appears near selection
- Extracts original markdown from selection (not just rendered HTML)
- Handles partial selections and multi-message spans
- Auto-hides when clicking elsewhere

**Markdown Extraction**:
- Identifies source message(s) by DOM mapping
- Maps selected HTML back to markdown positions
- Returns full message markdown if entire message selected
- Cleans up UI artifacts (copy buttons, action buttons)

#### Streaming Indicators

**During Streaming**:
- Typing dots animation before first content
- Animated cursor at end of text while streaming
- "Stop" button (red) to cancel stream

**After Streaming**:
- Syntax highlighting applied
- Mermaid diagrams rendered
- Tool popups auto-closed
- "Send" button restored

**Stopped by User**:
- Message appended with `*[stopped]*` indicator
- Partial content preserved
- All tool popups closed immediately

---

### Model and Tools Selection

#### Model Selection

**Model Dropdown**:
- Lists all available models from `/v1/models`
- Shows model ID and owner
- Highlights currently selected model
- Auto-loads on page load

**Model Display**:
- Button shows current model name
- Clicking toggles dropdown
- Click outside closes dropdown

**Model with Tools Format**:
When tools are selected, the model string includes tool names:
```
gemini-2.0-flash|Bash|Edit
```

This tells the backend to enable only those specific tools.

#### Tools Selection

**Tool Dropdown**:
- Lists all available tools from `/v1/tools`
- Checkbox-style selection (visual only, not actual checkboxes)
- Shows tool name and description
- Displays count: "Tools: 3/10" or "Tools: All" or "Tools: None"

**Tool Selection Modes**:

1. **All Tools**: No tools in model string (backend uses all available)
2. **Specific Tools**: Comma-separated list in model string
3. **No Tools**: Empty set (backend operates without tools)

**Controls**:
- **All button**: Selects all non-Google tools
- **None button**: Deselects all tools

**Special Handling for Google Search**:
- Google search tools are mutually exclusive with other tools
- Selecting a Google tool deselects all others
- Selecting another tool deselects Google
- "All" button excludes Google search tools

**Persistence**:
- Tool selection persists within a conversation
- New conversations start with no tools selected

---

### File Attachments

The UI supports uploading and managing various file types.

#### Supported File Types

1. **Images**: `image/*` (JPEG, PNG, GIF, WebP, etc.)
2. **PDFs**: `application/pdf`
3. **Audio**: `audio/*` (WebM, MP3, WAV, etc.)

**Input Methods**:
- Click attachment button
- Drag and drop onto input area
- Paste images from clipboard

#### Upload Flow

1. **File Selection**:
   - Multiple files supported
   - Each file processed individually

2. **Size Check**:
   - **Threshold**: 25KB (very aggressive to prevent quota issues)
   - Small files (< 25KB): Converted to base64 data URL
   - Large files (≥ 25KB): Uploaded to artifact storage

3. **Artifact Upload** (for large files):
   ```javascript
   POST /artifact
   Headers:
     Content-Type: {file MIME type}
     X-Original-Filename: {filename}
   Body: {raw file data}

   Response: { artifactId: "unique-id" }
   ```

4. **Preview Generation**:
   - Creates visual preview card
   - Shows file type icon, name, size
   - "SERVER" badge for artifacts
   - Remove button (×)

#### File Preview Elements

**Images**:
- Thumbnail preview (max 300x300px)
- File size badge (top-right)
- Artifact indicator (green "SERVER" badge)
- Remove button

**PDFs**:
- PDF icon with filename
- File size display
- Remove button

**Audio**:
- Audio icon with truncated filename
- File size display
- Artifact indicator (if applicable)
- Remove button

#### Message Attachment Structure

When sent, attachments are converted to multimodal message content:

```javascript
{
  role: "user",
  content: [
    { type: "text", text: "Look at this image" },
    {
      type: "image_url",
      image_url: {
        url: "data:image/png;base64,iVBORw0KG..."
      }
    },
    {
      type: "file",
      file: {
        file_data: "data:application/pdf;base64,JVBERi0...",
        filename: "document.pdf"
      }
    },
    {
      type: "audio",
      audio: {
        data: "data:audio/webm;base64,GkXf..."
      }
    }
  ]
}
```

**Artifact References**:
Artifacts are resolved to full data URLs before sending to API:
```javascript
// Before sending, if dataURL is "artifact:abc123"
const artifactId = "abc123";
const dataURL = await fetchArtifactAsDataURL(artifactId);
// Then dataURL becomes "data:audio/webm;base64,..."
```

This ensures the API receives actual file data, not references.

---

## Storage Architecture

The UI implements a robust multi-tier storage strategy to handle browser limitations.

### Storage Hierarchy

1. **Primary**: `localStorage` (main storage)
2. **Backup**: `localStorage` with reduced data (stripped attachments)
3. **Fallback 1**: IndexedDB
4. **Fallback 2**: `sessionStorage` (emergency backup)
5. **Fallback 3**: Download as JSON file

### Conversation Data Structure

```javascript
{
  "conv_123456": {
    id: "conv_123456",
    title: "Conversation title",
    messages: [
      { role: "user", content: "..." },
      { role: "assistant", content: "..." }
    ],
    systemPrompt: "You are a helpful assistant...",
    createdAt: 1234567890,
    lastModified: 1234567891
  }
}
```

### Save Strategy

**Automatic Saves**:
- After each message sent/received
- On conversation switch
- Every 30 seconds (auto-save interval)
- On page unload/visibility change
- On system prompt change

**Debounced Saves**:
- 500ms delay to group rapid operations
- Prevents excessive saves during file uploads
- Groups multiple tool calls into single save

### Storage Quota Management

**Prevention**:
- Aggressive 25KB threshold for artifact storage
- Automatic stripping of large attachments from localStorage
- Web Workers for data optimization (reduce size before saving)

**Detection**:
```javascript
try {
  localStorage.setItem('chat_conversations', JSON.stringify(conversations));
} catch (error) {
  if (error.name === 'QuotaExceededError') {
    // Handle quota exceeded
  }
}
```

**Handling**:
1. **Reduce data**: Strip large attachments, keep only references
2. **Cleanup**: Remove old localStorage items
3. **Clear session storage**
4. **Try IndexedDB**: Use as fallback
5. **Offer download**: Auto-download backup JSON

### Data Reduction

When quota is exceeded or proactively:

**Stripped Content**:
```javascript
// Original
attachment.image_url.url = "data:image/png;base64,iVBORw0KG..."

// Stripped
attachment.image_url.url = "[LARGE_DATA_STRIPPED_USE_ARTIFACT]"
attachment.stripped = true
```

**Restoration**:
- `conversationHasStrippedContent(conversation)` checks for stripped data
- "Restore" button appears in conversation list
- `restoreConversationFromArtifacts(id)` fetches and restores

### Web Worker Integration

**Worker-Based Save** (when available):
```javascript
// Main thread
await this.workerManager.createReducedConversations(conversations);

// Worker processes data (non-blocking)
// Returns optimized conversation data

// Main thread saves result
localStorage.setItem('chat_conversations', JSON.stringify(optimizedData));
```

**Benefits**:
- Non-blocking data processing
- Faster UI responsiveness
- Parallel optimization

---

## Web Workers

The UI optionally uses Web Workers for heavy operations to keep the main thread responsive.

### Worker Types

1. **ConversationWorker** (`conversationWorker.js`):
   - Process conversations for storage
   - Prepare conversations for API requests
   - Calculate conversation statistics
   - Suggest cleanup strategies

2. **StorageWorker** (`storageWorker.js`):
   - Create reduced conversation data
   - Calculate storage usage
   - Suggest cleanup based on age/count
   - Emergency data generation

3. **MessageWorker** (`messageWorker.js`):
   - Process message content
   - Search messages
   - Export conversations
   - Process file attachments

### Worker Manager

**Initialization**:
```javascript
const workerManager = new WorkerManager('/ui');
await workerManager.init();
// Creates 3 workers, waits for ready signal
```

**Communication**:
```javascript
const result = await workerManager.sendToWorker(
  'conversation',
  'prepareForAPI',
  { conversation, systemPrompt, selectedTools }
);
```

**Error Handling**:
- Timeouts (30 seconds default)
- Automatic worker restart on failure
- Pending message cleanup
- Graceful fallback to synchronous processing

### Fallback Behavior

**Worker Initialization Timeout**:
- 8-second timeout for worker ready signal
- Falls back to synchronous processing
- UI shows "Using fallback mode" notification
- Core functionality remains available

**Worker Failure**:
- Errors caught and logged
- Fallback to direct JavaScript execution
- No impact on user experience (just slower)

### Performance Monitoring

```javascript
workerManager.getPerformanceStats();
// Returns:
{
  workers: [
    { type: 'conversation', available: true, activeJobs: 2, totalJobsProcessed: 150 },
    { type: 'storage', available: true, activeJobs: 0, totalJobsProcessed: 45 },
    { type: 'message', available: true, activeJobs: 1, totalJobsProcessed: 78 }
  ],
  pendingMessages: 3,
  initialized: true
}
```

---

## Code Organization

### File Structure

```
host/openaiserver/ui/agentflow/
├── templates/
│   └── chat-ui.html.tmpl           # Main HTML template
├── static/
│   ├── css/
│   │   └── styles.css              # UI styles
│   ├── js/
│   │   ├── chat.js                 # Main ChatUI class (~6000 lines)
│   │   ├── workerManager.js        # Worker orchestration
│   │   └── workers/
│   │       ├── conversationWorker.js
│   │       ├── storageWorker.js
│   │       └── messageWorker.js
│   └── images/
│       ├── favicon.ico
│       ├── favicon.svg
│       └── apple-touch-icon.png
```

### Main Classes

**ChatUI** (`chat.js`):
- Main application controller
- ~6000 lines
- Manages all UI interactions
- Coordinates with workers

**WorkerManager** (`workerManager.js`):
- Worker lifecycle management
- Message routing
- Load balancing
- Error recovery

### Key Methods

**ChatUI Methods** (selection):

- `init()`: Initialize UI and event listeners
- `sendMessage()`: Send user message
- `getAssistantResponse()`: Stream assistant response
- `handleStreamingResponse()`: Process SSE events
- `addMessage()`: Add message to conversation
- `renderMessages()`: Render all messages
- `saveConversations()`: Multi-tier save strategy
- `loadConversations()`: Multi-source load strategy
- `startRecording()`: Begin audio capture
- `handleFileSelection()`: Process file uploads
- `highlightCodeBlocks()`: Apply Prism.js syntax highlighting
- `renderMermaidDiagrams()`: Render Mermaid diagrams

### Event Handlers

**Core Events**:
- Message send (click, Enter key)
- Model/tool selection
- File attachment (click, drag-drop, paste)
- Audio recording (record, stop, segment)
- Conversation switching
- Message editing
- Text selection and copy

**Auto-save Events**:
- Page unload
- Visibility change
- Periodic interval (30s)
- After each message

### Template Variables

The HTML template receives:

```go
type TemplateData struct {
    BaseURL string  // Base URL for static assets
    APIURL  string  // API base URL for fetch requests
}
```

**Usage**:
- `{{.BaseURL}}` - For CSS, JS, image paths
- `{{.APIURL}}` - Injected as `window.AGENTFLOW_BASE_URL`

---

## Additional Features

### Input Resize

**Manual Resize**:
- Drag handle above input textarea
- Resize up/down with mouse or touch
- Min: 44px, Max: 300px
- Disables auto-resize after manual adjustment
- Visual opacity feedback during resize

### Conversation Grouping

**Date-based Groups**:
- Today
- Yesterday
- Specific dates (e.g., "October 1st 2025")

**Fold/Unfold**:
- Each group can be collapsed
- Material Icons indicate state (expand_more/expand_less)
- Groups start folded by default

### Notifications

**Toast Notifications**:
- Positioned top-right
- Color-coded by type (success, error, warning, info)
- Auto-dismiss after 5 seconds
- Click to dismiss early
- Slide-in/slide-out animations

**Types**:
- `success`: Green gradient (e.g., "Conversation exported")
- `error`: Red gradient (e.g., "Failed to upload file")
- `warning`: Orange gradient (e.g., "Storage quota exceeded")
- `info`: Blue gradient (e.g., "Workers initialized")

### Mobile Optimization

**Features**:
- Responsive design (viewport-fit=cover)
- Touch-friendly controls (larger buttons)
- Swipe gestures for menu (planned)
- Mobile web app capable
- Custom app icons and theme color

**Meta Tags**:
```html
<meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no, viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="theme-color" content="#1a1a2e">
```

---

## Technical Details

### Dependencies

**Client-side Libraries**:
- **Marked.js**: Markdown rendering
- **Prism.js**: Syntax highlighting (with autoloader)
- **Mermaid.js**: Diagram rendering
- **Material Icons**: Icon font

**CDN Resources**:
```html
<!-- Markdown -->
<script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>

<!-- Syntax Highlighting -->
<link href="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/themes/prism-tomorrow.min.css" rel="stylesheet" />
<script src="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/components/prism-core.min.js"></script>
<!-- Additional language components... -->

<!-- Diagrams -->
<script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>

<!-- Icons -->
<link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet">
```

### Browser Compatibility

**Required APIs**:
- Fetch API
- ReadableStream
- Web Workers (optional)
- MediaRecorder API (for audio recording)
- Web Audio API (for mixed audio)
- IndexedDB (fallback storage)
- Clipboard API (for copy features)

**Supported Browsers**:
- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+

### Performance Considerations

**Optimizations**:
- Web Workers for heavy processing
- Debounced save operations
- Lazy loading of diagrams
- Efficient SSE parsing
- Artifact storage for large files
- Reduced data in localStorage

**Potential Bottlenecks**:
- Large conversation history (mitigated by workers)
- Many large attachments (mitigated by artifacts)
- Complex Mermaid diagrams (rendered once)
- Syntax highlighting many code blocks (async with Prism)

---

## Future Enhancements

Potential areas for improvement:

1. **Search**: Full-text search across conversations
2. **Tags**: Organize conversations with custom tags
3. **Themes**: Light/dark mode toggle
4. **Keyboard Shortcuts**: Power user features
5. **Voice Input**: Real-time speech-to-text
6. **Collaboration**: Share conversations (read-only links)
7. **Plugins**: Extensible tool system
8. **Offline Mode**: Service worker caching
9. **Desktop App**: Electron wrapper
10. **Multi-language**: i18n support

---

## Security Considerations

**Current Measures**:
- No XSS vulnerabilities (Marked.js sanitizes by default)
- CORS headers for cross-origin requests
- No sensitive data in localStorage (only chat history)
- Artifact storage is server-side (no direct file access)

**Recommendations**:
- Add CSP headers for enhanced security
- Implement rate limiting on API endpoints
- Add authentication/authorization if needed
- Encrypt sensitive conversations
- Sanitize user-uploaded files on server

---

## OCTO Color System Specifications

This section defines the color usage rules for the OCTO brand, focusing on the palette, color variations, and contrast rules to ensure accessibility and readability.

### 1. Basic Principles

OCTO's graphic system is **bichrome**, based on the combination of **Navy Blue** and **Turquoise**.

- **Primary Color:** Navy Blue
- **Secondary Color:** Turquoise

### 2. Primary Color Palette

| Role | Color | Hexadecimal | Preview |
| :--- | :--- | :--- | :--- |
| **Primary** | Navy Blue | `#0E2356` | 🔵 |
| **Secondary** | Turquoise | `#00D2DD` | 💧 |
| **Background/Text** | White | `#FFFFFF` | ⚪ |

**Important Rule:** Turquoise (`#00D2DD`) should not be used for typography on light backgrounds (like white) and vice versa, as the contrast is insufficient.

### 3. Extended Palette (Color Variations)

To offer more flexibility, variations of Navy Blue and Turquoise are available.

#### 3.1. Navy Blue Variations

| Opacity | Hexadecimal |
| :--- | :--- |
| 100% | `#0E2356` |
| 90% | `#263967` |
| 80% | `#3E4F78` |
| 70% | `#586586` |
| 60% | `#6E7B9A` |
| 50% | `#8691AB` |
| 40% | `#9FA7BB` |
| 30% | `#B7BDCC` |
| 20% | `#CFD3DD` |
| 10% | `#E7E9EE` |

#### 3.2. Turquoise Variations

| Opacity | Hexadecimal |
| :--- | :--- |
| 100% | `#00D2DD` |
| 90% | `#3CD7E0` |
| 80% | `#5BDDE4` |
| 70% | `#72DFE7` |
| 60% | `#8AE4EB` |
| 50% | `#9EE9ED` |
| 40% | `#B2EEF2` |
| 30% | `#C6F1F5` |
| 20% | `#DAF6F9` |
| 10% | `#EBFAFB` |

### 4. Contrast and Accessibility Rules

Respecting contrast ratios is essential to ensure content readability.

#### 4.1. Contrast Level Legend

| Symbol | Meaning |
| :--- | :--- |
| `✓✓` | **Sufficient contrast.** Can be used for all text, regardless of size. |
| `✓` | **Limited contrast.** Can be used **only for large text** (minimum 18pt normal or 14pt bold). |
| `(empty)` | **Insufficient contrast.** Do not use this combination. |

#### 4.2. Simplified Contrast Matrix (Primary Colors)

This matrix summarizes the rules for primary colors. Rows represent background color and columns represent text color.

| ↓ Background / → Text | White (`#FFFFFF`) | Navy (`#0E2356`) | Turquoise (`#00D2DD`) |
| :--- | :--- | :--- | :--- |
| **White (`#FFFFFF`)** | | `✓✓` | |
| **Navy (`#0E2356`)** | `✓✓` | | `✓✓` |
| **Turquoise (`#00D2DD`)** | | `✓✓` | |

#### 4.3. Complete Contrast Matrix

This matrix details all valid combinations between colors in the extended palette.

*   **Rows:** Background color (`Background`)
*   **Columns:** Text color (`Foreground`)

| ↓ Bg / → Fg | `#FFFFFF` | `#0E2356` | `#3E4F78` | `#586586` | `#6E7B9A` | `#9FA7BB` | `#B7BDCC` | `#CFD3DD` | `#E7E9EE` | `#00D2DD` |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **`#FFFFFF`** | | `✓✓` | `✓✓` | `✓✓` | `✓` | | | | | |
| **`#0E2356`** | `✓✓` | | `✓✓` | `✓✓` | `✓✓` | `✓✓` | `✓✓` | `✓✓` | `✓✓` | `✓✓` |
| **`#3E4F78`** | `✓✓` | | | | `✓` | `✓✓` | `✓✓` | `✓✓` | `✓✓` | `✓` |
| **`#586586`** | `✓✓` | | | | | `✓` | `✓✓` | `✓✓` | `✓✓` | |
| **`#6E7B9A`** | `✓✓` | `✓` | | | | | `✓` | `✓✓` | `✓✓` | |
| **`#9FA7BB`** | `✓✓` | `✓✓` | `✓` | `✓` | | | | | `✓` | |
| **`#B7BDCC`** | `✓✓` | `✓✓` | `✓✓` | `✓` | `✓` | | | | | |
| **`#CFD3DD`** | `✓✓` | `✓✓` | `✓✓` | `✓✓` | `✓✓` | | | | | |
| **`#E7E9EE`** | `✓✓` | `✓✓` | `✓✓` | `✓✓` | `✓✓` | `✓` | | | | |
| **`#00D2DD`** | | `✓✓` | `✓` | | | | | | | |

### 5. Implementation Guidelines

When implementing the OCTO color system in the UI:

1. **Primary Usage**: Use Navy Blue (`#0E2356`) as the primary brand color for headers, important UI elements, and primary actions.

2. **Accent Usage**: Use Turquoise (`#00D2DD`) sparingly as an accent color, primarily on Navy Blue backgrounds or for highlights.

3. **Text Readability**: Always refer to the contrast matrices before choosing text/background combinations. Prioritize `✓✓` combinations for body text.

4. **Backgrounds**: Use White (`#FFFFFF`) for main content areas, Navy Blue for headers/navigation, and light variations (`#E7E9EE`, `#CFD3DD`) for subtle backgrounds.

5. **Interactive Elements**: Use sufficient contrast for buttons, links, and interactive elements. Navy Blue on white or Turquoise on Navy Blue are recommended combinations.

6. **Error/Warning States**: While not part of the primary palette, ensure any additional colors used for states (error, success, warning) maintain the same contrast standards.

---

## Conclusion

AgentFlow provides a comprehensive, modern web interface for interacting with agentic systems. Its architecture prioritizes:

- **Robustness**: Multi-tier storage with automatic fallbacks
- **Performance**: Web Workers for non-blocking operations
- **Usability**: Intuitive UI with rich features
- **Scalability**: Artifact storage prevents quota issues
- **Flexibility**: Embeddable or standalone deployment
- **Accessibility**: OCTO color system ensuring proper contrast and readability

The SSE-based streaming mechanism provides real-time feedback on both chat completions and tool executions, creating a responsive and transparent user experience.
