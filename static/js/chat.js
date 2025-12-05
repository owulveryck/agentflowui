/**
 * ChatUI - Main application class for AgentFlow
 * Handles UI interactions, storage, audio recording, and API communication
 */

class ChatUI {
    constructor() {
        // Configuration
        this.baseUrl = window.CONFIG?.API_BASE_URL || window.AGENTFLOW_BASE_URL || '';

        // Storage Manager (replaces localStorage)
        this.storageManager = new StorageManager();

        // State
        this.conversations = {};
        this.currentConversationId = null;
        this.messages = [];
        this.selectedModel = 'gemini-2.0-flash';
        this.systemPrompt = 'You are a helpful assistant.\nCurrent time is ' + new Date().toLocaleString();
        this.selectedFiles = [];
        this.isStreaming = false;

        // Storage flags
        this.storageQuotaExceeded = false;
        this.consecutiveSaveFailures = 0;

        // Audio recording state
        this.isRecording = false;
        this.mediaRecorder = null;
        this.audioStream = null;
        this.audioChunks = [];
        this.recordingStartTime = null;
        this.recordingTimerInterval = null;
        this.isCreatingLap = false;
        this.audioSource = 'microphone'; // microphone, system, mixed

        // Worker manager
        this.workerManager = null;
        this.workerReady = false;

        // Sync freshness timer
        this.syncFreshnessInterval = null;

        // Constants
        this.FILE_SIZE_THRESHOLD = 25 * 1024; // 25KB
        this.AUDIO_SIZE_THRESHOLD = 500 * 1024; // 500KB
        this.AUDIO_DURATION_THRESHOLD = 30 * 1000; // 30 seconds
    }

    /**
     * Initialize the application
     */
    async init() {
        console.log('Initializing AgentFlow UI...');

        // Initialize mermaid for diagram rendering
        if (typeof mermaid !== 'undefined') {
            mermaid.initialize({
                startOnLoad: false,
                theme: 'default',
                securityLevel: 'loose',
                fontFamily: 'inherit'
            });
        }

        // Get DOM elements
        this.setupDOMReferences();

        // Initialize storage manager
        await this.initializeStorage();

        // Initialize workers
        await this.initializeWorkers();

        // Load conversations from storage
        await this.loadConversations();

        // Create initial conversation if none exist
        if (Object.keys(this.conversations).length === 0) {
            this.createNewConversation();
        } else {
            // Load the most recent conversation
            const conversationIds = Object.keys(this.conversations);
            const mostRecent = conversationIds.reduce((latest, id) => {
                const conv = this.conversations[id];
                const latestConv = this.conversations[latest];
                return (conv.lastModified || 0) > (latestConv.lastModified || 0) ? id : latest;
            }, conversationIds[0]);
            this.loadConversation(mostRecent);
        }

        // Setup event listeners
        this.setupEventListeners();

        // Setup auto-save
        this.setupAutoSave();

        // Load models from API
        this.loadModels();

        // Load audio source preference
        const preferredSource = localStorage.getItem('preferredAudioSource') || 'microphone';
        this.selectAudioSource(preferredSource);

        // Start with menu collapsed
        this.sideMenu.classList.add('collapsed');

        console.log('AgentFlow UI initialized');
    }

    /**
     * Load models from API
     */
    async loadModels() {
        try {
            const response = await fetch(`${this.baseUrl}/v1/models`);
            if (!response.ok) {
                console.warn('Failed to load models:', response.status);
                return;
            }

            const data = await response.json();
            if (data.data && Array.isArray(data.data)) {
                this.renderModelList(data.data);
            }
        } catch (error) {
            console.error('Error loading models:', error);
        }
    }

    /**
     * Render model list in dropdown
     */
    renderModelList(models) {
        if (models.length === 0) return;

        let html = '';
        models.forEach(model => {
            const isSelected = model.id === this.selectedModel;
            html += `
                <div class="dropdown-item ${isSelected ? 'selected' : ''}" data-model="${model.id}">
                    ${model.id}
                </div>
            `;
        });

        this.modelList.innerHTML = html;

        // Update model button text
        this.modelBtn.querySelector('span:nth-child(2)').textContent = this.selectedModel;

        // Add click listeners
        document.querySelectorAll('#model-list .dropdown-item').forEach(item => {
            item.addEventListener('click', () => {
                this.selectModel(item.dataset.model);
            });
        });
    }

    /**
     * Select model
     */
    selectModel(modelId) {
        this.selectedModel = modelId;

        // Update UI
        document.querySelectorAll('#model-list .dropdown-item').forEach(item => {
            item.classList.toggle('selected', item.dataset.model === modelId);
        });

        this.modelBtn.querySelector('span:nth-child(2)').textContent = modelId;
        this.modelDropdown.classList.add('hidden');
    }

    /**
     * Setup DOM references
     */
    setupDOMReferences() {
        // Chat elements
        this.chatMessages = document.getElementById('chat-messages');
        this.userInput = document.getElementById('user-input');
        this.sendBtn = document.getElementById('send-btn');
        this.stopBtn = document.getElementById('stop-btn');

        // Model and tools
        this.modelBtn = document.getElementById('model-btn');
        this.modelDropdown = document.getElementById('model-dropdown');
        this.modelList = document.getElementById('model-list');

        // Recording controls
        this.recordBtn = document.getElementById('record-btn');
        this.stopRecordBtn = document.getElementById('stop-record-btn');
        this.segmentBtn = document.getElementById('segment-btn');
        this.recordingTimer = document.getElementById('recording-timer');
        this.recordingIndicator = document.getElementById('recording-indicator');
        this.audioSourceBtn = document.getElementById('audio-source-btn');
        this.audioSourceDropdown = document.getElementById('audio-source-dropdown');

        // File attachment
        this.attachBtn = document.getElementById('attach-btn');
        this.fileInput = document.getElementById('file-input');
        this.filePreview = document.getElementById('file-preview');

        // Side menu
        this.menuToggle = document.getElementById('menu-toggle');
        this.sideMenu = document.getElementById('side-menu');
        this.newChatBtn = document.getElementById('new-chat-btn');
        this.conversationsList = document.getElementById('conversations-list');
        this.systemPromptTextarea = document.getElementById('system-prompt');
        this.exportBtn = document.getElementById('export-btn');
        this.importBtn = document.getElementById('import-btn');
        this.importInput = document.getElementById('import-input');

        // Google Drive sync
        this.gdriveStatus = document.getElementById('gdrive-status');
        this.syncIndicator = document.getElementById('sync-indicator');
        this.syncStatusText = document.getElementById('sync-status-text');
        this.syncActionIcon = document.getElementById('sync-action-icon');
    }

    /**
     * Initialize web workers
     */
    async initializeWorkers() {
        try {
            this.workerManager = new WorkerManager(this.baseUrl);
            const result = await this.workerManager.init();

            if (result.success) {
                this.workerReady = true;
                console.log('Workers initialized successfully');
            } else {
                console.warn('Workers failed to initialize, using fallback mode');
                this.workerReady = false;
            }
        } catch (error) {
            console.error('Worker initialization error:', error);
            this.workerReady = false;
        }
    }

    /**
     * Initialize storage manager
     */
    async initializeStorage() {
        try {
            await this.storageManager.init();

            // Setup storage event listeners
            this.storageManager.on('auth-success', () => {
                this.showNotification('Connected to Google Drive - Loading conversations...', 'success');
                this.updateSyncUI();
            });

            this.storageManager.on('sync-mode-changed', (mode) => {
                this.updateSyncUI();
            });

            this.storageManager.on('full-sync-started', () => {
                this.updateSyncUI('syncing');
            });

            this.storageManager.on('sync-started', () => {
                this.updateSyncUI('syncing');
            });

            this.storageManager.on('sync-completed', () => {
                this.updateSyncUI();
            });

            this.storageManager.on('full-sync-completed', async () => {
                console.log('Full sync completed - Reloading conversations from storage...');

                // Reload all conversations from storage (includes Google Drive data)
                await this.loadConversations();
                this.renderConversationsList();
                this.updateSyncUI();

                console.log(`UI updated with ${Object.keys(this.conversations).length} conversations`);

                // If we have no current conversation, load the most recent one
                if (!this.currentConversationId || !this.conversations[this.currentConversationId]) {
                    const conversationIds = Object.keys(this.conversations);
                    if (conversationIds.length > 0) {
                        const mostRecent = conversationIds.reduce((latest, id) => {
                            const conv = this.conversations[id];
                            const latestConv = this.conversations[latest];
                            return (conv.lastModified || 0) > (latestConv.lastModified || 0) ? id : latest;
                        }, conversationIds[0]);
                        console.log(`Loading most recent conversation: ${mostRecent}`);
                        this.loadConversation(mostRecent);
                    }
                }
            });

            this.storageManager.on('sync-error', (error) => {
                this.updateSyncUI('error');
                this.showNotification(`Sync error: ${error.message}`, 'error');
                console.error('Storage sync error:', error);
            });

            // Update UI initially
            this.updateSyncUI();

            // Start sync freshness checker
            this.startSyncFreshnessChecker();

            console.log('Storage manager initialized');
        } catch (error) {
            console.error('Failed to initialize storage:', error);
            this.showNotification('Storage initialization failed', 'error');
        }
    }

    /**
     * Start sync freshness checker
     * Updates indicator color based on time since last sync
     */
    startSyncFreshnessChecker() {
        // Clear any existing timer
        if (this.syncFreshnessInterval) {
            clearInterval(this.syncFreshnessInterval);
        }

        // Check every second
        this.syncFreshnessInterval = setInterval(() => {
            this.updateSyncFreshness();
        }, 1000);
    }

    /**
     * Update sync freshness indicator
     */
    updateSyncFreshness() {
        const status = this.storageManager.getSyncStatus();

        // Only update freshness when online and not syncing
        if (status.mode !== 'online' || status.syncing) {
            return;
        }

        if (!status.lastSyncTime) {
            return;
        }

        const timeSinceSync = Date.now() - status.lastSyncTime;
        const seconds = Math.floor(timeSinceSync / 1000);

        // Update indicator color based on freshness
        this.syncIndicator.className = 'status-indicator';

        if (seconds >= 60) {
            // Red: Not synced for 1 minute or more
            this.syncIndicator.classList.add('stale');
        } else if (seconds >= 30) {
            // Orange: Not synced for 30 seconds
            this.syncIndicator.classList.add('aging');
        } else {
            // Green: Recently synced
            this.syncIndicator.classList.add('online');
        }
    }

    /**
     * Update sync UI based on current status
     */
    updateSyncUI(forceState = null) {
        const status = this.storageManager.getSyncStatus();
        const state = forceState || status.mode;

        // Update indicator
        this.syncIndicator.className = 'status-indicator';
        this.syncIndicator.classList.add(state);

        // Update text and icon based on state
        const uiConfig = {
            'offline': {
                text: 'Click to connect',
                icon: 'cloud_upload'
            },
            'online': {
                text: 'Connected • Click for options',
                icon: 'cloud_done'
            },
            'syncing': {
                text: 'Syncing...',
                icon: 'sync'
            },
            'error': {
                text: 'Sync error • Click to retry',
                icon: 'cloud_off'
            }
        };

        const config = uiConfig[state] || uiConfig['offline'];
        this.syncStatusText.textContent = config.text;
        this.syncActionIcon.textContent = config.icon;
    }

    /**
     * Setup event listeners
     */
    setupEventListeners() {
        // Send message
        this.sendBtn.addEventListener('click', () => this.sendMessage());
        this.userInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
            }
        });

        // Stop streaming
        this.stopBtn.addEventListener('click', () => this.stopStreaming());

        // Recording controls
        this.recordBtn.addEventListener('click', () => this.startRecording());
        this.stopRecordBtn.addEventListener('click', () => this.stopRecording());
        this.segmentBtn.addEventListener('click', () => this.createSegment());

        // Audio source selection
        this.audioSourceBtn.addEventListener('click', () => {
            this.audioSourceDropdown.classList.toggle('hidden');
        });

        document.querySelectorAll('.audio-source-option').forEach(option => {
            option.addEventListener('click', () => {
                this.selectAudioSource(option.dataset.source);
                this.audioSourceDropdown.classList.add('hidden');
            });
        });

        // File attachment
        this.attachBtn.addEventListener('click', () => this.fileInput.click());
        this.fileInput.addEventListener('change', (e) => {
            this.handleFileSelection(Array.from(e.target.files));
            e.target.value = '';
        });

        // Side menu toggle
        this.menuToggle.addEventListener('click', () => {
            this.sideMenu.classList.toggle('collapsed');
        });

        this.newChatBtn.addEventListener('click', () => this.createNewConversation());

        // System prompt
        this.systemPromptTextarea.addEventListener('change', () => {
            this.systemPrompt = this.systemPromptTextarea.value;
            this.saveConversations();
        });

        // Export/Import
        this.exportBtn.addEventListener('click', () => this.exportConversation());
        this.importBtn.addEventListener('click', () => this.importInput.click());
        this.importInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                this.importConversation(e.target.files[0]);
                e.target.value = '';
            }
        });

        // Google Drive Sync - Click handler
        this.gdriveStatus.addEventListener('click', async () => {
            const status = this.storageManager.getSyncStatus();

            if (status.mode === 'offline') {
                // Offline -> Connect
                try {
                    await this.storageManager.connectGoogleDrive();
                } catch (error) {
                    console.error('Failed to connect to Google Drive:', error);
                    this.showNotification('Failed to connect to Google Drive', 'error');
                }
            } else if (status.mode === 'online') {
                // Online -> Show options menu
                const action = confirm('Google Drive is connected.\n\nClick OK to sync now, or Cancel to disconnect.');

                if (action) {
                    // Sync
                    try {
                        this.updateSyncUI('syncing');
                        await this.storageManager.fullSync();
                    } catch (error) {
                        console.error('Sync failed:', error);
                        this.showNotification('Sync failed', 'error');
                        this.updateSyncUI('error');
                    }
                } else {
                    // Disconnect
                    try {
                        await this.storageManager.disconnectGoogleDrive();
                        this.showNotification('Disconnected from Google Drive', 'success');
                        this.updateSyncUI();
                    } catch (error) {
                        console.error('Failed to disconnect:', error);
                        this.showNotification('Failed to disconnect', 'error');
                    }
                }
            }
        });

        // Model dropdown
        this.modelBtn.addEventListener('click', () => {
            this.modelDropdown.classList.toggle('hidden');
        });

        // Close dropdowns when clicking outside
        document.addEventListener('click', (e) => {
            if (!this.modelBtn.contains(e.target) && !this.modelDropdown.contains(e.target)) {
                this.modelDropdown.classList.add('hidden');
            }
            if (!this.audioSourceBtn.contains(e.target) && !this.audioSourceDropdown.contains(e.target)) {
                this.audioSourceDropdown.classList.add('hidden');
            }
        });
    }

    /**
     * Setup auto-save mechanism
     */
    setupAutoSave() {
        // Save every 30 seconds
        setInterval(() => {
            if (this.messages && this.messages.length > 0 && !this.storageQuotaExceeded) {
                this.saveConversations();
            }
        }, 30000);

        // Save on page unload
        window.addEventListener('beforeunload', () => {
            this.saveConversations();
        });

        // Save on visibility change
        document.addEventListener('visibilitychange', () => {
            if (document.hidden && this.messages && this.messages.length > 0) {
                this.saveConversations();
            }
        });
    }

    /**
     * Load conversations from storage
     */
    async loadConversations() {
        try {
            this.conversations = await this.storageManager.loadConversations();
            console.log(`Loaded ${Object.keys(this.conversations).length} conversations`);
        } catch (error) {
            console.error('Failed to load conversations:', error);
            this.conversations = {};
        }
    }

    /**
     * Clean conversations for storage (convert base64 back to gdrive:// references)
     */
    cleanConversationsForStorage(conversations) {
        const cleaned = JSON.parse(JSON.stringify(conversations));

        for (const convId in cleaned) {
            const conv = cleaned[convId];
            if (conv.messages) {
                conv.messages = conv.messages.map(msg => {
                    if (Array.isArray(msg.content)) {
                        msg.content = msg.content.map(item => {
                            // Restore Google Drive reference for audio if it was cached
                            if (item.type === 'audio' && item.audio) {
                                if (item.audio._gdriveUrl) {
                                    // Restore original gdrive:// URL
                                    return {
                                        type: 'audio',
                                        audio: {
                                            data: item.audio._gdriveUrl
                                        }
                                    };
                                } else if (item.audio.data && !item.audio.data.startsWith('gdrive://')) {
                                    // Remove inline base64 data
                                    return {
                                        type: 'audio',
                                        audio: {
                                            data: '[Audio data not saved to conserve storage]'
                                        }
                                    };
                                }
                            }
                            // Restore Google Drive reference for images if it was cached
                            if (item.type === 'image_url' && item.image_url) {
                                if (item.image_url._gdriveUrl) {
                                    // Restore original gdrive:// URL
                                    return {
                                        type: 'image_url',
                                        image_url: {
                                            url: item.image_url._gdriveUrl
                                        }
                                    };
                                } else if (item.image_url.url && !item.image_url.url.startsWith('gdrive://')) {
                                    // Remove inline base64 data
                                    return {
                                        type: 'image_url',
                                        image_url: {
                                            url: '[Large image data removed to save storage space]'
                                        }
                                    };
                                }
                            }
                            return item;
                        });
                    }
                    return msg;
                });
            }
        }

        return cleaned;
    }

    /**
     * Save conversations to storage (now using StorageManager)
     */
    async saveConversations() {
        // Update current conversation
        if (this.currentConversationId && this.messages.length > 0) {
            if (!this.conversations[this.currentConversationId]) {
                const firstUserMessage = this.messages.find(msg => msg.role === 'user');
                const title = firstUserMessage ?
                    firstUserMessage.content.substring(0, 50).trim() +
                    (firstUserMessage.content.length > 50 ? '...' : '') :
                    'New Conversation';

                this.conversations[this.currentConversationId] = {
                    id: this.currentConversationId,
                    title: title,
                    createdAt: Date.now(),
                    lastModified: Date.now(),
                    messages: [],
                    systemPrompt: this.systemPrompt
                };
            }

            this.conversations[this.currentConversationId].messages = [...this.messages];
            this.conversations[this.currentConversationId].lastModified = Date.now();
            this.conversations[this.currentConversationId].systemPrompt = this.systemPrompt;
        }

        // Save current conversation using StorageManager
        if (this.currentConversationId && this.conversations[this.currentConversationId]) {
            try {
                await this.storageManager.saveConversation(this.conversations[this.currentConversationId]);
                this.storageQuotaExceeded = false;
                this.consecutiveSaveFailures = 0;
            } catch (error) {
                console.error('Failed to save conversation:', error);
                this.consecutiveSaveFailures++;
                this.showNotification('Failed to save conversation', 'error');
            }
        }
    }

    /**
     * Save with reduced data using worker
     */
    async saveWithReducedData() {
        try {
            // Clean conversations before reducing
            const cleanedConversations = this.cleanConversationsForStorage(this.conversations);
            const result = await this.workerManager.createReducedConversations(cleanedConversations);

            if (result.success) {
                localStorage.setItem('chat_conversations', JSON.stringify(result.data));
                this.showNotification('Conversations saved with reduced data', 'warning');
            }
        } catch (error) {
            console.error('Failed to save with reduced data:', error);
            this.showNotification('Failed to save conversations. Please export manually.', 'error');
        }
    }

    /**
     * Create new conversation
     */
    createNewConversation() {
        const id = `conv_${Date.now()}`;
        this.currentConversationId = id;
        this.messages = [];
        this.selectedFiles = [];

        this.conversations[id] = {
            id: id,
            title: 'New Conversation',
            createdAt: Date.now(),
            lastModified: Date.now(),
            messages: [],
            systemPrompt: this.systemPrompt
        };

        this.renderMessages();
        this.renderConversationsList();
        this.saveConversations();

        // Auto-collapse menu
        this.sideMenu.classList.add('collapsed');
    }

    /**
     * Load conversation
     */
    async loadConversation(id) {
        const conv = this.conversations[id];
        if (!conv) return;

        this.currentConversationId = id;
        this.messages = conv.messages || [];
        this.systemPrompt = conv.systemPrompt || this.systemPrompt;
        this.systemPromptTextarea.value = this.systemPrompt;
        this.selectedFiles = [];

        // Download and cache all Google Drive artifacts in this conversation
        await this.cacheGoogleDriveArtifacts();

        this.renderMessages();
        this.renderConversationsList();

        // Auto-collapse menu
        this.sideMenu.classList.add('collapsed');
    }

    /**
     * Delete conversation
     */
    async deleteConversation(id) {
        if (!confirm('Are you sure you want to delete this conversation?')) {
            return;
        }

        delete this.conversations[id];

        // Delete from storage manager
        try {
            await this.storageManager.deleteConversation(id);
        } catch (error) {
            console.error('Failed to delete conversation from storage:', error);
        }

        if (this.currentConversationId === id) {
            const conversationIds = Object.keys(this.conversations);
            if (conversationIds.length > 0) {
                this.loadConversation(conversationIds[0]);
            } else {
                this.createNewConversation();
            }
        }

        this.renderConversationsList();
    }

    /**
     * Render conversations list
     */
    renderConversationsList() {
        const conversationIds = Object.keys(this.conversations);

        if (conversationIds.length === 0) {
            this.conversationsList.innerHTML = '<div class="empty-state">No conversations yet</div>';
            return;
        }

        // Sort by last modified
        const sorted = conversationIds.sort((a, b) => {
            const aTime = this.conversations[a].lastModified || 0;
            const bTime = this.conversations[b].lastModified || 0;
            return bTime - aTime;
        });

        let html = '';
        sorted.forEach(id => {
            const conv = this.conversations[id];
            const isActive = id === this.currentConversationId;

            html += `
                <div class="conversation-item ${isActive ? 'active' : ''}" data-id="${id}">
                    <div class="conversation-title">${this.escapeHtml(conv.title)}</div>
                    <div class="conversation-actions">
                        <button class="icon-btn-small rename-conv-btn" data-id="${id}" title="Rename">
                            <span class="material-icons">edit</span>
                        </button>
                        <button class="icon-btn-small duplicate-conv-btn" data-id="${id}" title="Duplicate">
                            <span class="material-icons">content_copy</span>
                        </button>
                        <button class="icon-btn-small delete-conv-btn" data-id="${id}" title="Delete">
                            <span class="material-icons">delete</span>
                        </button>
                    </div>
                </div>
            `;
        });

        this.conversationsList.innerHTML = html;

        // Add event listeners
        document.querySelectorAll('.conversation-item').forEach(item => {
            item.addEventListener('click', (e) => {
                if (!e.target.closest('.conversation-actions')) {
                    this.loadConversation(item.dataset.id);
                }
            });
        });

        document.querySelectorAll('.rename-conv-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.renameConversation(btn.dataset.id);
            });
        });

        document.querySelectorAll('.duplicate-conv-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.duplicateConversation(btn.dataset.id);
            });
        });

        document.querySelectorAll('.delete-conv-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.deleteConversation(btn.dataset.id);
            });
        });
    }

    /**
     * Rename conversation
     */
    renameConversation(id) {
        const conv = this.conversations[id];
        if (!conv) return;

        const newTitle = prompt('Enter new conversation title:', conv.title);
        if (newTitle && newTitle.trim()) {
            conv.title = newTitle.trim();
            conv.lastModified = Date.now();
            this.renderConversationsList();
            this.saveConversations();
        }
    }

    /**
     * Duplicate conversation
     */
    duplicateConversation(id) {
        const conv = this.conversations[id];
        if (!conv) return;

        const newId = `conv_${Date.now()}`;
        this.conversations[newId] = {
            id: newId,
            title: conv.title + ' (Copy)',
            createdAt: Date.now(),
            lastModified: Date.now(),
            messages: JSON.parse(JSON.stringify(conv.messages || [])),
            systemPrompt: conv.systemPrompt
        };

        this.renderConversationsList();
        this.saveConversations();
        this.showNotification('Conversation duplicated', 'success');
    }

    /**
     * Cache Google Drive artifacts by downloading and converting to base64 in-memory
     * This happens once when a conversation is loaded
     * We keep the original gdrive:// URL for saving back to storage later
     */
    async cacheGoogleDriveArtifacts() {
        for (let i = 0; i < this.messages.length; i++) {
            const msg = this.messages[i];

            if (Array.isArray(msg.content)) {
                for (let j = 0; j < msg.content.length; j++) {
                    const item = msg.content[j];

                    // Download and cache Google Drive images
                    if (item.type === 'image_url' && item.image_url && item.image_url.url.startsWith('gdrive://')) {
                        try {
                            const gdriveUrl = item.image_url.url;
                            const dataURL = await this.storageManager.downloadArtifact(gdriveUrl);
                            // Store both: base64 for display/API, gdrive:// for storage
                            msg.content[j].image_url._gdriveUrl = gdriveUrl;
                            msg.content[j].image_url.url = dataURL;
                            console.log('Cached Google Drive image');
                        } catch (error) {
                            console.error('Failed to cache Google Drive image:', error);
                        }
                    }

                    // Download and cache Google Drive audio
                    if (item.type === 'audio' && item.audio && item.audio.data.startsWith('gdrive://')) {
                        try {
                            const gdriveUrl = item.audio.data;
                            const dataURL = await this.storageManager.downloadArtifact(gdriveUrl);
                            // Store both: base64 for display/API, gdrive:// for storage
                            msg.content[j].audio._gdriveUrl = gdriveUrl;
                            msg.content[j].audio.data = dataURL;
                            console.log('Cached Google Drive audio');
                        } catch (error) {
                            console.error('Failed to cache Google Drive audio:', error);
                        }
                    }
                }
            }
        }
    }

    /**
     * Render messages
     */
    renderMessages() {
        if (!this.messages || this.messages.length === 0) {
            this.chatMessages.innerHTML = '<div class="empty-state">Start a conversation...</div>';
            return;
        }

        let html = '';
        this.messages.forEach((msg, index) => {
            html += this.renderMessage(msg, index);
        });

        this.chatMessages.innerHTML = html;
        this.scrollToBottom();

        // Render mermaid diagrams if present
        if (typeof mermaid !== 'undefined') {
            mermaid.run({
                querySelector: '.mermaid'
            });
        }

        // Add event listeners for message actions
        document.querySelectorAll('.edit-msg-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const index = parseInt(btn.dataset.index);
                this.editMessage(index);
            });
        });

        document.querySelectorAll('.replay-msg-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const index = parseInt(btn.dataset.index);
                this.replayFromMessage(index);
            });
        });
    }

    /**
     * Render single message
     */
    renderMessage(msg, index) {
        const isUser = msg.role === 'user';
        const content = msg.content || '';

        return `
            <div class="message ${isUser ? 'user-message' : 'assistant-message'}" data-index="${index}">
                <div class="message-content">
                    ${this.renderMessageContent(content)}
                </div>
                <div class="message-actions">
                    <button class="action-btn edit-msg-btn" data-index="${index}" title="Edit">
                        <span class="material-icons">edit</span>
                    </button>
                    ${isUser ? `
                        <button class="action-btn replay-msg-btn" data-index="${index}" title="Replay from here">
                            <span class="material-icons">replay</span>
                        </button>
                    ` : ''}
                </div>
                ${msg.timestamp ? `<div class="message-time">${new Date(msg.timestamp).toLocaleTimeString()}</div>` : ''}
            </div>
        `;
    }

    /**
     * Render message content with markdown (using legacy renderMarkdown method)
     */
    renderMessageContent(content) {
        if (!content) return '';

        // Handle multimodal content (array of items)
        if (Array.isArray(content)) {
            let html = '';

            for (const item of content) {
                if (item.type === 'text') {
                    html += this.renderMarkdown(item.text);
                } else if (item.type === 'image_url' && item.image_url) {
                    const url = item.image_url.url;
                    if (url !== '[Large image data removed to save storage space]') {
                        html += `<div class="message-image"><img src="${this.escapeHtml(url)}" alt="Attached image" /></div>`;
                    } else {
                        html += `<div class="message-file-placeholder"><span class="material-icons">image</span> <em>Image not available</em></div>`;
                    }
                } else if (item.type === 'audio' && item.audio) {
                    const data = item.audio.data;
                    if (data && data !== '[Audio data not saved to conserve storage]') {
                        html += `<div class="message-audio" data-audio="${this.escapeHtml(data)}">
                            <span class="material-icons">audiotrack</span>
                            <span class="audio-label">Audio file</span>
                        </div>`;
                    } else {
                        html += `<div class="message-file-placeholder"><span class="material-icons">audiotrack</span> <em>Audio not available</em></div>`;
                    }
                }
            }

            return html;
        }

        // Handle simple string content
        return this.renderMarkdown(content);
    }

    /**
     * Render markdown with custom renderer (from legacy)
     */
    renderMarkdown(text) {
        if (!text) return '';

        // Configure marked to allow HTML (including SVG)
        const customRenderer = this.getCustomRenderer();

        // Try new marked.js API first, then fall back to old API
        let html;
        try {
            // New API (marked v4+)
            html = marked.parse(text || '', {
                breaks: true,
                gfm: true,
                sanitize: false,
                renderer: customRenderer
            });
        } catch (error) {
            console.log('New API failed, trying old API:', error);
            // Old API (marked v3 and below)
            marked.setOptions({
                breaks: true,
                gfm: true,
                sanitize: false,
                renderer: customRenderer
            });
            html = marked.parse ? marked.parse(text || '') : marked(text || '');
        }

        return html;
    }

    /**
     * Get custom marked.js renderer with code copy buttons (from legacy)
     */
    getCustomRenderer() {
        const renderer = new marked.Renderer();
        const chatUI = this; // Capture reference to this instance

        // Custom code block renderer with copy button and syntax highlighting
        renderer.code = function(code, infoString, escaped) {
            // Handle the case where code might be an object (modern marked.js)
            let codeText;
            let language;

            if (typeof code === 'object' && code !== null) {
                // Modern marked.js passes a token object
                codeText = code.text || code.raw || String(code);
                language = code.lang || infoString;
            } else if (typeof code === 'string') {
                // Legacy API or simple string
                codeText = code;
                language = infoString;
            } else {
                codeText = String(code || '');
                language = infoString;
            }

            // Extract language from infoString
            let validLang = 'text';
            if (language && typeof language === 'string' && language.trim()) {
                validLang = language.trim().split(/\s+/)[0].toLowerCase();
            } else if (infoString && typeof infoString === 'string' && infoString.trim()) {
                validLang = infoString.trim().split(/\s+/)[0].toLowerCase();
            }

            // Check if this is a mermaid diagram
            if (validLang === 'mermaid') {
                const mermaidId = 'mermaid_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
                return `<div class="mermaid-container">
                    <div class="mermaid" id="${mermaidId}">${chatUI.escapeHtml(codeText)}</div>
                </div>`;
            }

            const codeId = 'code_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);

            // Ensure we have valid code text
            if (!codeText || codeText === '[object Object]') {
                codeText = 'Code content not available';
            }

            // Escape HTML to prevent XSS
            const escapedCode = chatUI.escapeHtml(codeText);

            return `<div class="code-block-container">
                <div class="code-block-header">
                    <span class="code-language">${validLang.toUpperCase()}</span>
                    <button class="code-copy-btn" onclick="chatUI.copyCodeBlock('${codeId}', this)" title="Copy code">
                        <span class="material-icons">content_copy</span>
                    </button>
                </div>
                <pre class="code-block"><code id="${codeId}" class="language-${validLang}">${escapedCode}</code></pre>
            </div>`;
        };

        return renderer;
    }

    /**
     * Copy code block content (from legacy)
     */
    async copyCodeBlock(codeId, buttonElement) {
        try {
            const codeElement = document.getElementById(codeId);
            if (!codeElement) return;

            // Get text content
            let codeText = codeElement.textContent || codeElement.innerText;

            // Decode HTML entities if present
            if (codeText.includes('&lt;') || codeText.includes('&gt;') || codeText.includes('&amp;')) {
                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = codeText;
                codeText = tempDiv.textContent || tempDiv.innerText || codeText;
            }

            await navigator.clipboard.writeText(codeText);

            // Visual feedback
            const originalContent = buttonElement.innerHTML;
            buttonElement.innerHTML = `<span class="material-icons">check</span>`;
            buttonElement.classList.add('copied');

            // Reset after 2 seconds
            setTimeout(() => {
                buttonElement.innerHTML = originalContent;
                buttonElement.classList.remove('copied');
            }, 2000);

        } catch (error) {
            console.error('Failed to copy code:', error);
            buttonElement.innerHTML = '<span class="material-icons">error</span>';
            setTimeout(() => {
                buttonElement.innerHTML = `<span class="material-icons">content_copy</span>`;
            }, 2000);
        }
    }

    /**
     * Escape HTML
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * Edit message in-place
     */
    editMessage(index) {
        const message = this.messages[index];
        if (!message) return;

        // Get the content as a string and extract attachments
        let textContent = '';
        let attachments = [];

        if (typeof message.content === 'string') {
            textContent = message.content;
        } else if (Array.isArray(message.content)) {
            // For multimodal content, extract text and attachments
            message.content.forEach(item => {
                if (item.type === 'text') {
                    textContent += item.text;
                } else {
                    attachments.push(item);
                }
            });
        }

        // Get the message element
        const messageElements = this.chatMessages.querySelectorAll('.message');
        const messageElement = messageElements[index];
        if (!messageElement) return;

        const messageContent = messageElement.querySelector('.message-content');
        if (!messageContent) return;

        // Store original HTML for cancel
        const originalHTML = messageContent.innerHTML;

        // Build attachments HTML
        let attachmentsHTML = '';
        if (attachments.length > 0) {
            attachmentsHTML = '<div class="edit-attachments">';
            attachments.forEach((item, idx) => {
                if (item.type === 'image_url' && item.image_url) {
                    attachmentsHTML += `
                        <div class="edit-attachment" data-index="${idx}">
                            <span class="material-icons">image</span>
                            <span>Image</span>
                            <button class="remove-attachment-btn" data-index="${idx}">
                                <span class="material-icons">close</span>
                            </button>
                        </div>
                    `;
                } else if (item.type === 'audio' && item.audio) {
                    attachmentsHTML += `
                        <div class="edit-attachment" data-index="${idx}">
                            <span class="material-icons">audiotrack</span>
                            <span>Audio file</span>
                            <button class="remove-attachment-btn" data-index="${idx}">
                                <span class="material-icons">close</span>
                            </button>
                        </div>
                    `;
                }
            });
            attachmentsHTML += '</div>';
        }

        // Replace with textarea for editing
        messageContent.innerHTML = `
            <div class="edit-container">
                <textarea class="edit-textarea" rows="5">${this.escapeHtml(textContent)}</textarea>
                ${attachmentsHTML}
                <div class="edit-buttons">
                    <button class="action-btn save-edit">Save</button>
                    <button class="action-btn cancel-edit">Cancel</button>
                </div>
            </div>
        `;

        const textarea = messageContent.querySelector('.edit-textarea');
        const saveBtn = messageContent.querySelector('.save-edit');
        const cancelBtn = messageContent.querySelector('.cancel-edit');

        // Handle attachment removal
        let remainingAttachments = [...attachments];
        messageContent.querySelectorAll('.remove-attachment-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const idx = parseInt(btn.dataset.index);
                remainingAttachments = remainingAttachments.filter((_, i) => i !== idx);
                btn.closest('.edit-attachment').remove();
            });
        });

        // Auto-resize textarea
        textarea.style.height = 'auto';
        textarea.style.height = textarea.scrollHeight + 'px';
        textarea.addEventListener('input', () => {
            textarea.style.height = 'auto';
            textarea.style.height = textarea.scrollHeight + 'px';
        });

        // Focus textarea
        textarea.focus();

        // Save handler
        saveBtn.onclick = () => {
            const newText = textarea.value.trim();

            // Rebuild content
            if (remainingAttachments.length > 0 || newText) {
                if (remainingAttachments.length === 0) {
                    // Text only
                    message.content = newText;
                } else {
                    // Multimodal content
                    const newContent = [];
                    if (newText) {
                        newContent.push({ type: 'text', text: newText });
                    }
                    newContent.push(...remainingAttachments);
                    message.content = newContent;
                }

                message.timestamp = Date.now();
                this.renderMessages();
                this.saveConversations();
            } else {
                messageContent.innerHTML = originalHTML;
            }
        };

        // Cancel handler
        cancelBtn.onclick = () => {
            messageContent.innerHTML = originalHTML;
        };

        // Save on Ctrl+Enter
        textarea.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                saveBtn.click();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                cancelBtn.click();
            }
        });
    }

    /**
     * Replay from message (restart conversation from this point)
     */
    async replayFromMessage(index) {
        if (!confirm('Remove all messages after this point and regenerate response?')) {
            return;
        }

        // Remove all messages after this index
        this.messages = this.messages.slice(0, index + 1);
        this.renderMessages();
        this.saveConversations();

        // Regenerate assistant response
        await this.getAssistantResponse();
    }

    /**
     * Send message
     */
    async sendMessage() {
        const text = this.userInput.value.trim();

        if (!text && this.selectedFiles.length === 0) {
            return;
        }

        // Build message content - download gdrive:// to base64 before adding to messages
        let messageContent = text;

        // If we have files, create multimodal content
        if (this.selectedFiles.length > 0) {
            messageContent = [
                { type: 'text', text: text || 'Attached files' }
            ];

            // Add files - download gdrive:// URLs and cache as base64
            for (const file of this.selectedFiles) {
                let dataURL = file.dataURL;
                let gdriveUrl = null;

                // Download Google Drive files to base64 for in-memory use
                if (file.dataURL.startsWith('gdrive://')) {
                    gdriveUrl = file.dataURL;
                    try {
                        dataURL = await this.storageManager.downloadArtifact(file.dataURL);
                    } catch (error) {
                        console.error('Failed to download Google Drive file:', error);
                        this.showNotification(`Failed to load file from Google Drive: ${error.message}`, 'error');
                        return;
                    }
                }

                if (file.fileType.startsWith('image/')) {
                    const imageData = {
                        type: 'image_url',
                        image_url: { url: dataURL }
                    };
                    // Keep original gdrive URL for storage
                    if (gdriveUrl) {
                        imageData.image_url._gdriveUrl = gdriveUrl;
                    }
                    messageContent.push(imageData);
                } else if (file.fileType.startsWith('audio/')) {
                    const audioData = {
                        type: 'audio',
                        audio: { data: dataURL }
                    };
                    // Keep original gdrive URL for storage
                    if (gdriveUrl) {
                        audioData.audio._gdriveUrl = gdriveUrl;
                    }
                    messageContent.push(audioData);
                }
            }
        }

        // Add user message
        const userMessage = {
            role: 'user',
            content: messageContent,
            timestamp: Date.now()
        };

        this.messages.push(userMessage);

        // Clear input and files
        this.userInput.value = '';
        this.selectedFiles = [];
        this.filePreview.innerHTML = '';

        // Render messages
        this.renderMessages();

        // Get assistant response
        await this.getAssistantResponse();

        // Save conversation
        this.saveConversations();
    }

    /**
     * Get assistant response from API
     */
    async getAssistantResponse() {
        try {
            // Prepare messages for API
            let apiMessages = [];

            if (this.workerReady) {
                const result = await this.workerManager.prepareConversationForAPI(
                    { messages: this.messages },
                    this.systemPrompt,
                    this.selectedModel
                );

                if (result.success) {
                    apiMessages = result.data.messages;
                }
            } else {
                // Fallback: prepare manually
                if (this.systemPrompt) {
                    apiMessages.push({
                        role: 'system',
                        content: this.systemPrompt
                    });
                }

                this.messages.forEach(msg => {
                    apiMessages.push({
                        role: msg.role,
                        content: msg.content
                    });
                });
            }

            // Note: Google Drive artifacts are already cached as base64 in this.messages
            // from cacheGoogleDriveArtifacts(), so no need to resolve them here

            // Create assistant message placeholder
            const assistantMessage = {
                role: 'assistant',
                content: '',
                timestamp: Date.now()
            };

            this.messages.push(assistantMessage);
            this.renderMessages();

            // Show stop button
            this.isStreaming = true;
            this.sendBtn.classList.add('hidden');
            this.stopBtn.classList.remove('hidden');

            // Call API
            const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: this.selectedModel,
                    messages: apiMessages,
                    stream: true,
                    temperature: 0.7,
                    max_tokens: 2000
                })
            });

            if (!response.ok) {
                throw new Error(`API error: ${response.status}`);
            }

            // Handle streaming response
            await this.handleStreamingResponse(response, assistantMessage);

        } catch (error) {
            console.error('Error getting assistant response:', error);
            this.showNotification(`Error: ${error.message}`, 'error');

            // Remove incomplete assistant message
            if (this.messages[this.messages.length - 1].role === 'assistant') {
                this.messages.pop();
                this.renderMessages();
            }
        } finally {
            this.isStreaming = false;
            this.sendBtn.classList.remove('hidden');
            this.stopBtn.classList.add('hidden');
        }
    }

    /**
     * Handle streaming response from API
     */
    async handleStreamingResponse(response, assistantMessage) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        try {
            while (true) {
                const { done, value } = await reader.read();

                if (done || !this.isStreaming) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (!line.trim() || !line.startsWith('data: ')) continue;

                    const data = line.slice(6);
                    if (data === '[DONE]') {
                        this.isStreaming = false;
                        break;
                    }

                    try {
                        const parsed = JSON.parse(data);

                        if (parsed.choices && parsed.choices[0]) {
                            const delta = parsed.choices[0].delta;

                            if (delta && delta.content) {
                                assistantMessage.content += delta.content;

                                // Update last message
                                const lastMessageDiv = this.chatMessages.querySelector('.message:last-child .message-content');
                                if (lastMessageDiv) {
                                    lastMessageDiv.innerHTML = this.renderMessageContent(assistantMessage.content);

                                    // Render mermaid diagrams if present in the updated content
                                    if (typeof mermaid !== 'undefined') {
                                        const mermaidElements = lastMessageDiv.querySelectorAll('.mermaid');
                                        if (mermaidElements.length > 0) {
                                            mermaid.run({
                                                nodes: mermaidElements
                                            });
                                        }
                                    }
                                }

                                this.scrollToBottom();
                            }
                        }
                    } catch (e) {
                        console.warn('Failed to parse SSE data:', e);
                    }
                }
            }
        } catch (error) {
            console.error('Streaming error:', error);
            throw error;
        }
    }

    /**
     * Stop streaming
     */
    stopStreaming() {
        this.isStreaming = false;
        this.sendBtn.classList.remove('hidden');
        this.stopBtn.classList.add('hidden');
    }

    /**
     * Select audio source
     */
    selectAudioSource(source) {
        this.audioSource = source;

        // Update button text
        const sourceNames = {
            'microphone': 'Microphone',
            'system': 'System Audio',
            'mixed': 'Mic + System'
        };

        this.audioSourceBtn.querySelector('span:last-child').textContent = sourceNames[source];

        // Store preference
        localStorage.setItem('preferredAudioSource', source);

        // Update dropdown selection
        document.querySelectorAll('.audio-source-option').forEach(option => {
            option.classList.toggle('selected', option.dataset.source === source);
        });
    }

    /**
     * Get audio stream based on selected source
     */
    async getAudioStream() {
        switch (this.audioSource) {
            case 'microphone':
                return await navigator.mediaDevices.getUserMedia({
                    audio: {
                        echoCancellation: true,
                        noiseSuppression: true,
                        autoGainControl: true
                    }
                });

            case 'system':
                return await navigator.mediaDevices.getDisplayMedia({
                    video: false,
                    audio: {
                        echoCancellation: false,
                        noiseSuppression: false
                    }
                });

            case 'mixed':
                try {
                    const audioContext = new AudioContext();
                    const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
                    const systemStream = await navigator.mediaDevices.getDisplayMedia({ audio: true });

                    const micSource = audioContext.createMediaStreamSource(micStream);
                    const systemSource = audioContext.createMediaStreamSource(systemStream);
                    const destination = audioContext.createMediaStreamDestination();

                    const micGain = audioContext.createGain();
                    micGain.gain.value = 0.7;

                    const systemGain = audioContext.createGain();
                    systemGain.gain.value = 0.8;

                    micSource.connect(micGain);
                    micGain.connect(destination);

                    systemSource.connect(systemGain);
                    systemGain.connect(destination);

                    return destination.stream;
                } catch (error) {
                    console.warn('Failed to create mixed audio, falling back to microphone:', error);
                    return await navigator.mediaDevices.getUserMedia({ audio: true });
                }

            default:
                throw new Error('Invalid audio source');
        }
    }

    /**
     * Start recording
     */
    async startRecording() {
        try {
            // Get audio stream
            if (!this.audioStream || this.audioStream.getTracks().some(track => track.readyState === 'ended')) {
                this.audioStream = await this.getAudioStream();
            }

            // Determine MIME type
            const mimeTypes = [
                'audio/webm; codecs=opus',
                'audio/webm',
                'audio/mp4',
                'audio/wav'
            ];

            let mimeType = 'audio/wav';
            for (const type of mimeTypes) {
                if (MediaRecorder.isTypeSupported(type)) {
                    mimeType = type;
                    break;
                }
            }

            // Create MediaRecorder
            this.mediaRecorder = new MediaRecorder(this.audioStream, {
                mimeType,
                audioBitsPerSecond: 128000
            });

            this.audioChunks = [];

            this.mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    this.audioChunks.push(event.data);
                }
            };

            this.mediaRecorder.onstop = () => {
                this.processRecording();
            };

            // Start recording
            this.mediaRecorder.start();
            this.isRecording = true;
            this.recordingStartTime = Date.now();

            // Update UI
            this.updateRecordingUI(true);
            this.startRecordingTimer();

        } catch (error) {
            console.error('Failed to start recording:', error);
            this.showNotification(`Recording failed: ${error.message}`, 'error');
        }
    }

    /**
     * Stop recording
     */
    stopRecording() {
        if (this.mediaRecorder && this.isRecording) {
            this.isCreatingLap = false;
            this.mediaRecorder.stop();
            this.isRecording = false;
            this.stopRecordingTimer();

            // Stop all tracks
            if (this.audioStream) {
                this.audioStream.getTracks().forEach(track => track.stop());
                this.audioStream = null;
            }

            this.updateRecordingUI(false);
        }
    }

    /**
     * Create segment (lap)
     */
    createSegment() {
        if (this.mediaRecorder && this.isRecording) {
            this.isCreatingLap = true;
            this.mediaRecorder.stop();
            this.isRecording = false;
        }
    }

    /**
     * Process recording
     */
    async processRecording() {
        try {
            const audioBlob = new Blob(this.audioChunks, {
                type: this.mediaRecorder.mimeType
            });

            const duration = Date.now() - this.recordingStartTime;
            const filename = `recording_${Date.now()}.${this.getFileExtension(this.mediaRecorder.mimeType)}`;

            // Try to upload recording to Google Drive
            let recordingAdded = false;

            const syncStatus = this.storageManager.getSyncStatus();
            if (syncStatus.mode === 'online') {
                try {
                    const gdriveUrl = await this.storageManager.uploadArtifact(audioBlob, filename);

                    this.selectedFiles.push({
                        fileName: filename,
                        fileType: this.mediaRecorder.mimeType,
                        fileSize: audioBlob.size,
                        dataURL: gdriveUrl,
                        isArtifact: true,
                        source: 'gdrive'
                    });
                    recordingAdded = true;
                    console.log('Recording uploaded to Google Drive');
                } catch (gdriveError) {
                    console.warn('Google Drive upload failed for recording:', gdriveError.message);
                }
            }

            // Fallback: create temporary dataURL (won't be saved)
            if (!recordingAdded) {
                const dataURL = await this.blobToDataURL(audioBlob);
                this.selectedFiles.push({
                    fileName: filename,
                    fileType: this.mediaRecorder.mimeType,
                    fileSize: audioBlob.size,
                    dataURL: dataURL,
                    isArtifact: false,
                    temporary: true
                });
                this.showNotification('Recording added (will not be saved - connect to Google Drive to save)', 'warning');
            }

            this.renderFilePreview();

            // If this was a lap, start new recording
            if (this.isCreatingLap) {
                this.isCreatingLap = false;
                setTimeout(() => {
                    this.startRecording();
                }, 100);
            }

        } catch (error) {
            console.error('Failed to process recording:', error);
            this.showNotification(`Failed to process recording: ${error.message}`, 'error');
        }
    }

    /**
     * Update recording UI
     */
    updateRecordingUI(isRecording) {
        if (isRecording) {
            this.recordBtn.classList.add('hidden');
            this.stopRecordBtn.classList.remove('hidden');
            this.segmentBtn.classList.remove('hidden');
            this.recordingIndicator.classList.remove('hidden');
        } else {
            this.recordBtn.classList.remove('hidden');
            this.stopRecordBtn.classList.add('hidden');
            this.segmentBtn.classList.add('hidden');
            this.recordingIndicator.classList.add('hidden');
        }
    }

    /**
     * Start recording timer
     */
    startRecordingTimer() {
        this.recordingTimerInterval = setInterval(() => {
            if (this.recordingStartTime) {
                const elapsed = Date.now() - this.recordingStartTime;
                const minutes = Math.floor(elapsed / 60000);
                const seconds = Math.floor((elapsed % 60000) / 1000);
                this.recordingTimer.textContent =
                    `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
            }
        }, 1000);
    }

    /**
     * Stop recording timer
     */
    stopRecordingTimer() {
        if (this.recordingTimerInterval) {
            clearInterval(this.recordingTimerInterval);
            this.recordingTimerInterval = null;
        }
        this.recordingTimer.textContent = '00:00';
    }

    /**
     * Handle file selection
     */
    async handleFileSelection(files) {
        for (const file of files) {
            if (file.type.startsWith('image/') ||
                file.type === 'application/pdf' ||
                file.type.startsWith('audio/')) {

                try {
                    const isAudio = file.type.startsWith('audio/');
                    const isImage = file.type.startsWith('image/');
                    let fileAdded = false;

                    // Try Google Drive if online - always upload images and audio to avoid losing them
                    const syncStatus = this.storageManager.getSyncStatus();
                    if (syncStatus.mode === 'online' && (isAudio || isImage || file.size > this.FILE_SIZE_THRESHOLD)) {
                        try {
                            const gdriveUrl = await this.storageManager.uploadArtifact(file, file.name);

                            this.selectedFiles.push({
                                fileName: file.name,
                                fileType: file.type,
                                fileSize: file.size,
                                dataURL: gdriveUrl,
                                isArtifact: true,
                                source: 'gdrive'
                            });
                            fileAdded = true;
                            console.log('File uploaded to Google Drive:', gdriveUrl);
                        } catch (gdriveError) {
                            console.warn('Google Drive upload failed:', gdriveError.message);
                            // Will fallback below
                        }
                    }

                    // Fallback: store inline if Google Drive upload failed or offline
                    if (!fileAdded) {
                        if (isAudio || isImage) {
                            // Audio/Images without Google Drive: create temporary dataURL that won't be saved
                            const dataURL = await this.fileToDataURL(file);

                            this.selectedFiles.push({
                                fileName: file.name,
                                fileType: file.type,
                                fileSize: file.size,
                                dataURL: dataURL,
                                isArtifact: false,
                                temporary: true // Mark as temporary - will be removed before saving
                            });

                            const fileTypeLabel = isAudio ? 'Audio' : 'Image';
                            this.showNotification(`${fileTypeLabel} added (will not be saved - connect to Google Drive to save)`, 'warning');
                        } else {
                            // Store PDFs as data URL (small files)
                            const dataURL = await this.fileToDataURL(file);

                            this.selectedFiles.push({
                                fileName: file.name,
                                fileType: file.type,
                                fileSize: file.size,
                                dataURL: dataURL,
                                isArtifact: false
                            });
                        }
                    }

                    this.renderFilePreview();

                } catch (error) {
                    console.error('File processing error:', error);
                    this.showNotification(`Failed to process ${file.name}`, 'error');
                }
            }
        }
    }

    /**
     * Render file preview
     */
    async renderFilePreview() {
        if (this.selectedFiles.length === 0) {
            this.filePreview.innerHTML = '';
            return;
        }

        let html = '';
        for (let index = 0; index < this.selectedFiles.length; index++) {
            const file = this.selectedFiles[index];
            const sizeStr = this.formatFileSize(file.fileSize);
            let badge = '';

            if (file.isArtifact) {
                badge = '<span class="artifact-badge">GDRIVE</span>';
            } else if (file.temporary) {
                badge = '<span class="artifact-badge" style="background-color: var(--warning-color);">TEMP</span>';
            }

            // Show image thumbnail for image files
            let thumbnail = '';
            if (file.fileType.startsWith('image/')) {
                let imageUrl = file.dataURL;

                // Download Google Drive images for preview
                if (file.dataURL.startsWith('gdrive://')) {
                    try {
                        imageUrl = await this.storageManager.downloadArtifact(file.dataURL);
                    } catch (error) {
                        console.warn('Failed to download Google Drive thumbnail:', error);
                        thumbnail = `<div class="file-preview-thumbnail-placeholder"><span class="material-icons">image</span></div>`;
                    }
                }

                if (!thumbnail && imageUrl) {
                    thumbnail = `<img src="${this.escapeHtml(imageUrl)}" alt="${this.escapeHtml(file.fileName)}" class="file-preview-thumbnail" />`;
                }
            }

            html += `
                <div class="file-preview-item" data-index="${index}">
                    ${thumbnail}
                    <div class="file-info">
                        <span class="file-name">${this.escapeHtml(file.fileName)}</span>
                        <span class="file-size">${sizeStr}</span>
                        ${badge}
                    </div>
                    <button class="remove-file-btn" data-index="${index}">
                        <span class="material-icons">close</span>
                    </button>
                </div>
            `;
        }

        this.filePreview.innerHTML = html;

        // Add remove listeners
        document.querySelectorAll('.remove-file-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const index = parseInt(btn.dataset.index);
                this.selectedFiles.splice(index, 1);
                this.renderFilePreview();
            });
        });
    }

    /**
     * Convert file to data URL
     */
    fileToDataURL(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target.result);
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }

    /**
     * Convert blob to data URL
     */
    blobToDataURL(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    }

    /**
     * Export conversation
     */
    async exportConversation() {
        if (!this.currentConversationId) {
            this.showNotification('No conversation to export', 'warning');
            return;
        }

        const conversation = this.conversations[this.currentConversationId];

        try {
            let result;

            if (this.workerReady) {
                result = await this.workerManager.exportConversationAsMarkdown(conversation);
            } else {
                // Fallback to simple export
                const content = JSON.stringify(conversation, null, 2);
                result = {
                    success: true,
                    data: {
                        content,
                        filename: `conversation_${Date.now()}.json`,
                        mimeType: 'application/json'
                    }
                };
            }

            if (result.success) {
                this.downloadFile(result.data.content, result.data.filename, result.data.mimeType);
                this.showNotification('Conversation exported', 'success');
            }

        } catch (error) {
            console.error('Export failed:', error);
            this.showNotification('Export failed', 'error');
        }
    }

    /**
     * Import conversation
     */
    async importConversation(file) {
        try {
            const fileName = file.name.toLowerCase();
            const text = await file.text();

            let data;

            // Try to determine file type and parse accordingly
            if (fileName.endsWith('.json')) {
                // Parse as JSON
                try {
                    data = JSON.parse(text);
                } catch (parseError) {
                    this.showNotification('Invalid JSON file format', 'error');
                    console.error('JSON parse error:', parseError);
                    return;
                }
            } else if (fileName.endsWith('.md') || fileName.endsWith('.txt')) {
                // Parse as markdown
                const parsed = this.parseMarkdownConversation(text);

                if (!parsed.messages || parsed.messages.length === 0) {
                    this.showNotification('No messages found in markdown file', 'error');
                    return;
                }

                data = {
                    title: parsed.title || file.name.replace(/\.[^/.]+$/, ''),
                    messages: parsed.messages,
                    systemPrompt: parsed.systemPrompt || this.systemPrompt
                };
            } else {
                this.showNotification('Unsupported file type. Please use .json, .md, or .txt files', 'error');
                return;
            }

            // Validate conversation structure
            if (!data || typeof data !== 'object') {
                this.showNotification('Invalid conversation format', 'error');
                return;
            }

            const id = `conv_${Date.now()}`;
            this.conversations[id] = {
                id,
                title: data.title || 'Imported Conversation',
                createdAt: data.createdAt || Date.now(),
                lastModified: Date.now(),
                messages: data.messages || [],
                systemPrompt: data.systemPrompt || this.systemPrompt
            };

            this.saveConversations();
            this.loadConversation(id);
            this.showNotification(`Conversation "${data.title}" imported successfully`, 'success');

        } catch (error) {
            console.error('Import failed:', error);
            this.showNotification('Import failed: ' + error.message, 'error');
        }
    }

    /**
     * Parse markdown conversation format
     */
    parseMarkdownConversation(markdownText) {
        const lines = markdownText.split('\n');
        const messages = [];
        let currentMessage = null;
        let currentContent = [];
        let systemPrompt = '';
        let title = '';
        let inCodeBlock = false;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            // Track code blocks to avoid parsing headers inside them
            if (line.startsWith('```')) {
                inCodeBlock = !inCodeBlock;
            }

            if (inCodeBlock) {
                if (currentMessage) {
                    currentContent.push(line);
                }
                continue;
            }

            // Extract title (first H1)
            if (line.startsWith('# ') && !title) {
                title = line.substring(2).trim();
                continue;
            }

            // Extract system prompt
            if (line.includes('**System Prompt:**')) {
                const promptMatch = line.match(/\*\*System Prompt:\*\*\s*(.+)/);
                if (promptMatch) {
                    systemPrompt = promptMatch[1].trim();
                }
                continue;
            }

            // Check for message headers (H2 with emojis)
            if (line.match(/^## (👤 User|🤖 Assistant|🧠 Assistant)/)) {
                // Save previous message if exists
                if (currentMessage) {
                    currentMessage.content = currentContent.join('\n').trim();
                    if (currentMessage.content) {
                        messages.push(currentMessage);
                    }
                }

                // Start new message
                if (line.includes('👤 User')) {
                    currentMessage = { role: 'user', content: '' };
                } else {
                    currentMessage = { role: 'assistant', content: '' };
                }
                currentContent = [];
                continue;
            }

            // Skip metadata and separator lines
            if (line.startsWith('*Exported from') ||
                line.startsWith('**Created:**') ||
                line.startsWith('**Exported:**') ||
                line.trim() === '---') {
                continue;
            }

            // Add content to current message
            if (currentMessage) {
                currentContent.push(line);
            }
        }

        // Save last message if exists
        if (currentMessage && currentContent.length > 0) {
            currentMessage.content = currentContent.join('\n').trim();
            if (currentMessage.content) {
                messages.push(currentMessage);
            }
        }

        return {
            title: title,
            systemPrompt: systemPrompt,
            messages: messages
        };
    }

    /**
     * Download file
     */
    downloadFile(content, filename, mimeType) {
        const blob = new Blob([content], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    }

    /**
     * Show notification
     */
    showNotification(message, type = 'info') {
        // Simple console notification for MVP
        console.log(`[${type.toUpperCase()}] ${message}`);

        // TODO: Implement toast notification UI
        alert(message);
    }

    /**
     * Utility functions
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    formatFileSize(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    }

    getFileExtension(mimeType) {
        const extensions = {
            'audio/webm': 'webm',
            'audio/mp4': 'mp4',
            'audio/wav': 'wav',
            'audio/webm; codecs=opus': 'webm'
        };
        return extensions[mimeType] || 'audio';
    }

    scrollToBottom() {
        this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
    }
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    const app = new ChatUI();
    app.init();

    // Make app globally accessible for debugging
    window.chatApp = app;
});
