# Getting Started with AgentFlow UI - MVP

## Quick Start (5 minutes)

### Prerequisites
- Modern web browser (Chrome 90+, Firefox 88+, Safari 14+)
- Python 3 (for local development server)
- API server compatible with OpenAI `/v1/chat/completions` endpoint

### Step 1: Configure API Endpoint

Edit `index.html` line 15:

```javascript
window.AGENTFLOW_BASE_URL = 'http://localhost:4000';
```

Change `http://localhost:4000` to your API server URL.

### Step 2: Start Development Server

```bash
# Navigate to project directory
cd /path/to/agentflowui

# Start server
python3 -m http.server 8080

# Or use npm
npm run dev
```

### Step 3: Open in Browser

Navigate to: `http://localhost:8080/index.html`

That's it! You should see the AgentFlow interface.

## First Steps in the UI

### 1. Create Your First Conversation

- The app automatically creates a "New Conversation" on first load
- Type a message in the input box at the bottom
- Press **Enter** or click the **Send** button
- Watch the streaming response appear

### 2. Try Audio Recording

**Basic Recording:**
1. Click the 🔴 **microphone icon**
2. Grant permission when prompted
3. Speak your message
4. Click ⏹️ **stop** to save

**Create Segments:**
1. Start recording (🔴)
2. Click ⏺️ **segment button** to save current recording
3. Recording automatically continues for next segment
4. Great for recording multiple audio clips in succession

**Change Audio Source:**
1. Click **Microphone** dropdown in header
2. Select:
   - **Microphone Only**: Voice input
   - **System Audio**: Capture desktop/app audio
   - **Mic + System**: Mixed audio (70% mic, 80% system)

### 3. Attach Files

**Method 1: Click to Attach**
1. Click 📎 **attachment icon**
2. Select files (images, PDFs, audio)
3. Files appear in preview area
4. Click ✖️ to remove

**Method 2: Drag and Drop** (Future)
- Drag files directly onto the input area

**File Size Handling:**
- Files < 25KB: Stored locally
- Files ≥ 25KB: Uploaded to artifact server
- Green "SERVER" badge indicates artifact storage

### 4. Manage Conversations

**Create New:**
- Click **+ New Chat** button in side menu
- Starts fresh conversation with current system prompt

**Switch Conversations:**
- Click any conversation in the list
- Active conversation highlighted

**Delete:**
- Click 🗑️ trash icon next to conversation
- Confirm deletion

**Export/Import:**
- **Export**: Download conversation as Markdown file
- **Import**: Load conversation from JSON file

### 5. Customize System Prompt

1. Open side menu (☰ button)
2. Edit text in **System Prompt** section
3. Changes apply to new messages

Example:
```
You are a coding assistant specialized in JavaScript.
Current time is 2024-12-04
Always provide working examples.
```

## Understanding the Interface

### Layout Overview

```
┌─────────────────────────────────────────────────────┐
│  ☰  AgentFlow        [Model ▼]  [Microphone ▼]    │ ← Header
├─────────────────────────────────────────────────────┤
│                                                     │
│  👤 User: Hello!                         9:30 AM   │
│                                                     │
│  🤖 Assistant: Hi there! How can I help? 9:30 AM   │ ← Messages
│                                                     │
│                                                     │
├─────────────────────────────────────────────────────┤
│  [🔴] [📎] [Type message here...        ] [Send]   │ ← Input
└─────────────────────────────────────────────────────┘
```

### Side Menu (☰)

```
┌──────────────────────┐
│  AgentFlow           │
│  [+ New Chat]        │
├──────────────────────┤
│  System Prompt       │
│  [Text area...]      │
├──────────────────────┤
│  [Export] [Import]   │
├──────────────────────┤
│  Conversations       │
│  • Chat 1  🗑️        │
│  • Chat 2  🗑️        │
│  • Chat 3  🗑️        │
└──────────────────────┘
```

### Mobile View

On mobile devices:
- Side menu slides from left
- Header controls stack vertically
- Messages use 90% width for better readability
- Touch-optimized buttons (larger tap targets)

## Keyboard Shortcuts

- **Enter**: Send message
- **Shift+Enter**: New line in message
- **Esc**: Close dropdowns (future)

## Testing the MVP

### Basic Functionality Test

1. ✅ Send a text message
2. ✅ Receive streaming response
3. ✅ Create new conversation
4. ✅ Switch between conversations
5. ✅ Delete a conversation
6. ✅ Export conversation
7. ✅ Import conversation

### Audio Recording Test

1. ✅ Record < 30 seconds (localStorage)
2. ✅ Record > 30 seconds (artifact storage)
3. ✅ Create segment while recording
4. ✅ Change audio source
5. ✅ Send recorded audio in message

### File Attachment Test

1. ✅ Attach small image < 25KB
2. ✅ Attach large image > 25KB
3. ✅ Attach PDF
4. ✅ Remove attached file
5. ✅ Send message with attachments

### Storage Test

1. ✅ Create 10+ conversations
2. ✅ Attach large files
3. ✅ Verify localStorage usage
4. ✅ Test with quota exceeded (intentionally fill storage)
5. ✅ Verify fallback to reduced data mode

### Worker Test

1. ✅ Open browser console
2. ✅ Look for "All workers initialized successfully"
3. ✅ Disable workers (edit code to skip init)
4. ✅ Verify app works in fallback mode

## Troubleshooting

### "Workers not initialized, using fallback mode"

**Cause:** Worker scripts not loading

**Check:**
```javascript
// Open browser console
console.log(window.location.origin);
// Should match path to worker scripts
```

**Fix:**
- Ensure you're serving via HTTP, not `file://`
- Check worker script paths in `workerManager.js`
- Verify no CORS errors in console

**Impact:** App works normally, just slower data processing

---

### "Storage quota exceeded"

**Symptoms:**
- Warning notification appears
- Automatic save failures

**What Happens Automatically:**
1. App switches to reduced data mode
2. Large attachments stripped from localStorage
3. Falls back to IndexedDB
4. After 3 failures, downloads backup

**Manual Fix:**
1. Export important conversations
2. Delete old conversations
3. Clear site data in browser settings
4. Import conversations back

---

### "Failed to load file: artifact not found"

**Cause:** Artifact server unavailable or artifact deleted

**Check:**
```javascript
// In browser console
console.log(window.AGENTFLOW_BASE_URL);
fetch(window.AGENTFLOW_BASE_URL + '/artifact/test');
```

**Fix:**
- Verify artifact server is running
- Check network tab for failed requests
- Confirm API URL is correct

**Workaround:**
- App falls back to storing all files as data URLs
- May hit quota limits faster

---

### Recording fails / No audio captured

**Common Issues:**

1. **Permission denied**
   - Grant microphone permission in browser
   - Check browser settings → Privacy → Microphone

2. **System audio not working**
   - Requires screen sharing permission
   - Not supported on iOS/Safari
   - May need desktop app on some systems

3. **Mixed audio fails**
   - App automatically falls back to microphone only
   - Check console for Web Audio API errors

---

### Streaming response stops mid-message

**Cause:** Network interruption or API error

**What to Check:**
1. Network tab in browser DevTools
2. API server logs
3. CORS configuration

**Recovery:**
- Partial message is preserved
- Try sending another message
- Check API server is running

---

## API Server Requirements

### Minimum Implementation

Your API server must support:

```http
POST /v1/chat/completions
Content-Type: application/json

# Request
{
  "model": "your-model-name",
  "messages": [...],
  "stream": true
}

# Response (SSE)
data: {"choices":[{"delta":{"content":"text"}}]}
data: [DONE]
```

### Optional Artifact Endpoints

For large file support:

```http
POST /artifact
Content-Type: {file type}
X-Original-Filename: {name}

# Returns
{ "artifactId": "unique-id" }

GET /artifact/{id}
# Returns binary file data
```

If not implemented:
- All files stored as data URLs
- May hit quota limits with large files
- App continues to work

## Next Steps

### Learn More
- Read [ARCHITECTURE.md](./ARCHITECTURE.md) for technical details
- Read [SPEC_UI.md](./SPEC_UI.md) for complete specifications

### Customize
- Modify OCTO colors in `static/css/styles.css`
- Add new models to dropdown
- Customize system prompt defaults
- Add custom file type support

### Deploy
- Build static site
- Deploy to any static host (Netlify, Vercel, GitHub Pages)
- Configure API URL via environment variables
- Setup artifact storage server

### Extend
- Add new export formats
- Implement search functionality
- Add tags/labels to conversations
- Create browser extension wrapper

## Support

For issues or questions:
1. Check browser console for errors
2. Review [Troubleshooting](#troubleshooting) section
3. Consult [ARCHITECTURE.md](./ARCHITECTURE.md) for technical details
4. Open issue on GitHub repository

## Tips for Best Experience

1. **Use Chrome/Edge for best compatibility**
   - Full Web Audio API support
   - Reliable MediaRecorder
   - Best worker performance

2. **Enable artifact server for heavy use**
   - Prevents quota issues
   - Faster with large files
   - Better for audio recordings

3. **Export regularly**
   - Backup important conversations
   - Markdown format is readable
   - JSON preserves all data

4. **Customize system prompt**
   - Tailor AI behavior
   - Include relevant context
   - Set response style preferences

5. **Use segments for long recordings**
   - Easier to manage
   - Smaller file sizes
   - Can delete unwanted parts

Enjoy using AgentFlow! 🚀
