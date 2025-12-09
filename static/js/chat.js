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
        this.recordingUploadInterval = null; // Periodic upload timer
        this.uploadedChunks = []; // Track chunks already uploaded
        this.currentRecordingGDriveId = null; // Track the GDrive file being built

        // Audio playback state
        this.currentlyPlayingAudio = null; // { audio: Audio, button: HTMLElement }

        // Audio visualization state
        this.audioContext = null;
        this.analyser = null;
        this.visualizerAnimationId = null;

        // Worker manager
        this.workerManager = null;
        this.workerReady = false;

        // Sync freshness timer
        this.syncFreshnessInterval = null;

        // Search state
        this.searchQuery = '';

        // Constants
        this.FILE_SIZE_THRESHOLD = 25 * 1024; // 25KB
        this.AUDIO_SIZE_THRESHOLD = 500 * 1024; // 500KB
        this.AUDIO_DURATION_THRESHOLD = 30 * 1000; // 30 seconds
        this.MAX_AUDIO_FILE_SIZE = 50 * 1024 * 1024; // 50MB - max size for base64 encoding to prevent browser crashes
        this.GDRIVE_SIZE_THRESHOLD = 5 * 1024 * 1024; // 5MB - files >= this size use gdrive:// URLs, smaller use base64
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

        // Restore system prompt collapsed state
        const systemPromptCollapsed = localStorage.getItem('systemPromptCollapsed') === 'true';
        if (systemPromptCollapsed) {
            this.systemPromptContent.classList.add('collapsed');
            this.systemPromptToggle.classList.add('collapsed');
            this.systemPromptToggle.querySelector('.material-icons').textContent = 'expand_more';
        }

        // Start with menu collapsed
        this.sideMenu.classList.add('collapsed');

        // Setup keyboard shortcuts
        this.setupKeyboardShortcuts();

        // Warn before closing if uploads or sync in progress
        this.setupBeforeUnloadWarning();

        console.log('AgentFlow UI initialized');
    }

    /**
     * Setup warning before closing tab if operations in progress
     */
    setupBeforeUnloadWarning() {
        window.addEventListener('beforeunload', (e) => {
            // Check if any uploads in progress
            const hasUploading = this.selectedFiles.some(file => file.uploading);

            // Check if storage sync in progress
            const syncStatus = this.storageManager.getSyncStatus();
            const isSyncing = syncStatus.syncing;

            if (hasUploading || isSyncing) {
                // Modern browsers require returnValue to be set
                e.preventDefault();
                e.returnValue = ''; // Chrome requires returnValue to be set

                // Some browsers use the return value
                return 'You have uploads or sync in progress. Are you sure you want to leave?';
            }
        });
    }

    /**
     * Setup keyboard shortcuts
     */
    setupKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
            const cmdOrCtrl = isMac ? e.metaKey : e.ctrlKey;

            // Cmd/Ctrl + B: Toggle side menu
            if (cmdOrCtrl && e.key === 'b') {
                e.preventDefault();
                this.sideMenu.classList.toggle('collapsed');
            }

            // Cmd/Ctrl + K: Focus conversation search
            if (cmdOrCtrl && e.key === 'k') {
                e.preventDefault();
                if (!this.sideMenu.classList.contains('collapsed')) {
                    this.conversationSearch.focus();
                } else {
                    // Open menu and focus search
                    this.sideMenu.classList.remove('collapsed');
                    setTimeout(() => this.conversationSearch.focus(), 100);
                }
            }

            // Cmd/Ctrl + N: New chat
            if (cmdOrCtrl && e.key === 'n') {
                e.preventDefault();
                this.createNewConversation();
            }

            // Escape: Close all dropdowns and collapse menu on mobile
            if (e.key === 'Escape') {
                this.modelDropdown.classList.add('hidden');
                this.audioSourceDropdown.classList.add('hidden');
                this.settingsDropdown.classList.add('hidden');

                // On mobile, also collapse menu
                if (window.innerWidth <= 768) {
                    this.sideMenu.classList.add('collapsed');
                }
            }
        });
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
        this.audioVisualizer = document.getElementById('audio-visualizer');

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

        // Settings dropdown
        this.settingsBtn = document.getElementById('settings-btn');
        this.settingsDropdown = document.getElementById('settings-dropdown');
        this.exportDropdownBtn = document.getElementById('export-dropdown-btn');
        this.exportGDocsBtn = document.getElementById('export-gdocs-btn');
        this.importDropdownBtn = document.getElementById('import-dropdown-btn');
        this.importInput = document.getElementById('import-input');

        // System prompt collapsible
        this.systemPromptHeader = document.getElementById('system-prompt-header');
        this.systemPromptToggle = document.getElementById('system-prompt-toggle');
        this.systemPromptContent = document.getElementById('system-prompt-content');

        // Google Drive sync
        this.gdriveStatus = document.getElementById('gdrive-status');
        this.syncIndicator = document.getElementById('sync-indicator');
        this.syncStatusText = document.getElementById('sync-status-text');
        this.syncActionIcon = document.getElementById('sync-action-icon');

        // Conversation search
        this.conversationSearch = document.getElementById('conversation-search');
        this.clearSearchBtn = document.getElementById('clear-search');
        this.conversationCount = document.getElementById('conversation-count');

        // Notification system
        this.notificationContainer = document.getElementById('notification-container');
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
            // Show initializing state if we might be connecting to Google Drive
            if (this.storageManager.auth.isAuthenticated()) {
                this.updateSyncUI('initializing');
            }

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
            'initializing': {
                text: 'Connecting to Google Drive...',
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

        this.newChatBtn.addEventListener('click', () => {
            this.createNewConversation();
            this.autoFoldMenu();
        });

        // Settings dropdown
        this.settingsBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.settingsDropdown.classList.toggle('hidden');
        });

        this.exportDropdownBtn.addEventListener('click', () => {
            this.exportConversation();
            this.settingsDropdown.classList.add('hidden');
        });

        this.exportGDocsBtn.addEventListener('click', () => {
            this.exportConversationToGoogleDocs();
            this.settingsDropdown.classList.add('hidden');
        });

        this.importDropdownBtn.addEventListener('click', () => {
            this.importInput.click();
            this.settingsDropdown.classList.add('hidden');
        });

        this.importInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                this.importConversation(e.target.files[0]);
                e.target.value = '';
            }
        });

        // System prompt collapsible
        this.systemPromptHeader.addEventListener('click', () => {
            this.toggleSystemPrompt();
        });

        this.systemPromptToggle.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleSystemPrompt();
        });

        // System prompt textarea change
        this.systemPromptTextarea.addEventListener('change', () => {
            this.systemPrompt = this.systemPromptTextarea.value;
            this.saveConversations();
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
            if (!this.settingsBtn.contains(e.target) && !this.settingsDropdown.contains(e.target)) {
                this.settingsDropdown.classList.add('hidden');
            }
        });

        // Auto-fold menu when typing in input
        this.userInput.addEventListener('focus', () => {
            this.autoFoldMenu();
        });

        // Auto-fold menu when clicking on chat messages area
        this.chatMessages.addEventListener('click', () => {
            this.autoFoldMenu();
        });

        // Search/Filter functionality
        this.conversationSearch.addEventListener('input', (e) => {
            this.searchQuery = e.target.value.toLowerCase();
            this.renderConversationsList();

            // Show/hide clear button
            if (this.searchQuery) {
                this.clearSearchBtn.classList.remove('hidden');
            } else {
                this.clearSearchBtn.classList.add('hidden');
            }
        });

        this.clearSearchBtn.addEventListener('click', () => {
            this.conversationSearch.value = '';
            this.searchQuery = '';
            this.clearSearchBtn.classList.add('hidden');
            this.renderConversationsList();
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
                                } else if (item.audio._uploadPending) {
                                    // Upload still pending - don't save (will be updated when upload completes)
                                    return {
                                        type: 'audio',
                                        audio: {
                                            data: '[Audio upload in progress - not saved]'
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
                                } else if (item.image_url._uploadPending) {
                                    // Upload still pending - don't save (will be updated when upload completes)
                                    return {
                                        type: 'image_url',
                                        image_url: {
                                            url: '[Image upload in progress - not saved]'
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
                            // Restore Google Drive reference for files (PDFs) if it was cached
                            if (item.type === 'file' && item.file) {
                                if (item.file._gdriveUrl) {
                                    // Restore original gdrive:// URL
                                    return {
                                        type: 'file',
                                        file: {
                                            file_data: item.file._gdriveUrl,
                                            filename: item.file.filename
                                        }
                                    };
                                } else if (item.file._uploadPending) {
                                    // Upload still pending - don't save (will be updated when upload completes)
                                    return {
                                        type: 'file',
                                        file: {
                                            file_data: '[File upload in progress - not saved]',
                                            filename: item.file.filename
                                        }
                                    };
                                } else if (item.file.file_data && !item.file.file_data.startsWith('gdrive://')) {
                                    // Remove inline base64 data
                                    return {
                                        type: 'file',
                                        file: {
                                            file_data: '[File data not saved to conserve storage]',
                                            filename: item.file.filename
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
                // Clean conversation before saving to remove large base64 data
                const cleanedConversations = this.cleanConversationsForStorage({
                    [this.currentConversationId]: this.conversations[this.currentConversationId]
                });
                const cleanedConversation = cleanedConversations[this.currentConversationId];

                await this.storageManager.saveConversation(cleanedConversation);
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
     * Toggle system prompt collapsed state
     */
    toggleSystemPrompt() {
        const isCollapsed = this.systemPromptContent.classList.contains('collapsed');

        if (isCollapsed) {
            // Expand
            this.systemPromptContent.classList.remove('collapsed');
            this.systemPromptToggle.classList.remove('collapsed');
            this.systemPromptToggle.querySelector('.material-icons').textContent = 'expand_less';
            localStorage.setItem('systemPromptCollapsed', 'false');
        } else {
            // Collapse
            this.systemPromptContent.classList.add('collapsed');
            this.systemPromptToggle.classList.add('collapsed');
            this.systemPromptToggle.querySelector('.material-icons').textContent = 'expand_more';
            localStorage.setItem('systemPromptCollapsed', 'true');
        }
    }

    /**
     * Auto-fold side menu (for better mobile UX)
     */
    autoFoldMenu() {
        // Only auto-fold on smaller screens or when menu is overlaying content
        const windowWidth = window.innerWidth;

        if (windowWidth <= 768 || !this.sideMenu.classList.contains('collapsed')) {
            this.sideMenu.classList.add('collapsed');
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

        // Note: Google Drive artifacts are kept as gdrive:// URLs
        // The backend will download them when processing the chat completion request
        // await this.cacheGoogleDriveArtifacts(); // REMOVED: Backend handles gdrive:// URLs now

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

        // Update conversation count
        this.conversationCount.textContent = conversationIds.length;

        if (conversationIds.length === 0) {
            this.conversationsList.innerHTML = '<div class="empty-state">No conversations yet<br><small>Click "New Chat" to start</small></div>';
            return;
        }

        // Filter by search query
        const filtered = conversationIds.filter(id => {
            const conv = this.conversations[id];
            if (!this.searchQuery) return true;

            const titleMatch = conv.title.toLowerCase().includes(this.searchQuery);
            const messagesMatch = conv.messages && conv.messages.some(msg => {
                const content = typeof msg.content === 'string' ? msg.content : '';
                return content.toLowerCase().includes(this.searchQuery);
            });

            return titleMatch || messagesMatch;
        });

        if (filtered.length === 0) {
            this.conversationsList.innerHTML = '<div class="empty-state">No conversations found<br><small>Try a different search</small></div>';
            return;
        }

        // Sort: pinned first, then by last modified
        const sorted = filtered.sort((a, b) => {
            const aPinned = this.conversations[a].pinned || false;
            const bPinned = this.conversations[b].pinned || false;

            // Pinned conversations come first
            if (aPinned && !bPinned) return -1;
            if (!aPinned && bPinned) return 1;

            // Then sort by last modified
            const aTime = this.conversations[a].lastModified || 0;
            const bTime = this.conversations[b].lastModified || 0;
            return bTime - aTime;
        });

        // Group by date (but keep pinned separate)
        const pinned = sorted.filter(id => this.conversations[id].pinned);
        const unpinned = sorted.filter(id => !this.conversations[id].pinned);

        const grouped = {};
        if (pinned.length > 0) {
            grouped['Pinned'] = pinned;
        }
        const unpinnedGrouped = this.groupConversationsByDate(unpinned);
        Object.assign(grouped, unpinnedGrouped);

        let html = '';
        for (const [groupLabel, convIds] of Object.entries(grouped)) {
            html += `<div class="conversation-group-label">${groupLabel}</div>`;

            convIds.forEach(id => {
                const conv = this.conversations[id];
                const isActive = id === this.currentConversationId;

                // Get message preview
                const preview = this.getMessagePreview(conv);
                const messageCount = conv.messages ? conv.messages.length : 0;
                const lastModified = this.formatRelativeTime(conv.lastModified);

                const isPinned = conv.pinned || false;
                const pinIcon = isPinned ? 'push_pin' : 'push_pin';
                const pinTitle = isPinned ? 'Unpin' : 'Pin';

                html += `
                    <div class="conversation-item ${isActive ? 'active' : ''} ${isPinned ? 'pinned' : ''}" data-id="${id}">
                        <div class="conversation-content">
                            <div class="conversation-title">
                                ${isPinned ? '<span class="material-icons pin-indicator">push_pin</span>' : ''}
                                ${this.escapeHtml(conv.title)}
                            </div>
                            <div class="conversation-preview">${this.escapeHtml(preview)}</div>
                            <div class="conversation-meta">
                                <span class="conversation-message-count">${messageCount} message${messageCount !== 1 ? 's' : ''}</span>
                                <span class="conversation-time">${lastModified}</span>
                            </div>
                        </div>
                        <div class="conversation-actions">
                            <button class="icon-btn-small pin-conv-btn" data-id="${id}" title="${pinTitle}">
                                <span class="material-icons">${pinIcon}</span>
                            </button>
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
        }

        this.conversationsList.innerHTML = html;

        // Add event listeners
        document.querySelectorAll('.conversation-item').forEach(item => {
            item.addEventListener('click', (e) => {
                if (!e.target.closest('.conversation-actions')) {
                    this.loadConversation(item.dataset.id);
                }
            });
        });

        document.querySelectorAll('.pin-conv-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.togglePinConversation(btn.dataset.id);
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
     * Group conversations by date
     */
    groupConversationsByDate(conversationIds) {
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        const thisWeek = new Date(today);
        thisWeek.setDate(thisWeek.getDate() - 7);

        const groups = {
            'Today': [],
            'Yesterday': [],
            'This Week': [],
            'Older': []
        };

        conversationIds.forEach(id => {
            const conv = this.conversations[id];
            const convDate = new Date(conv.lastModified || conv.createdAt || 0);

            if (convDate >= today) {
                groups['Today'].push(id);
            } else if (convDate >= yesterday) {
                groups['Yesterday'].push(id);
            } else if (convDate >= thisWeek) {
                groups['This Week'].push(id);
            } else {
                groups['Older'].push(id);
            }
        });

        // Remove empty groups
        const result = {};
        for (const [label, ids] of Object.entries(groups)) {
            if (ids.length > 0) {
                result[label] = ids;
            }
        }

        return result;
    }

    /**
     * Get message preview from conversation
     */
    getMessagePreview(conversation) {
        if (!conversation.messages || conversation.messages.length === 0) {
            return 'No messages';
        }

        // Get last user or assistant message
        const lastMessage = conversation.messages[conversation.messages.length - 1];
        let content = '';

        if (typeof lastMessage.content === 'string') {
            content = lastMessage.content;
        } else if (Array.isArray(lastMessage.content)) {
            // Extract text from multimodal content
            const textItem = lastMessage.content.find(item => item.type === 'text');
            if (textItem) {
                content = textItem.text;
            } else {
                // No text, show what types are present
                const types = lastMessage.content.map(item => {
                    if (item.type === 'image_url') return '🖼️ Image';
                    if (item.type === 'audio') return '🎵 Audio';
                    if (item.type === 'file') return '📄 File';
                    return item.type;
                });
                return types.join(', ');
            }
        }

        // Truncate to 60 characters
        return content.length > 60 ? content.substring(0, 60) + '...' : content;
    }

    /**
     * Format relative time
     */
    formatRelativeTime(timestamp) {
        if (!timestamp) return '';

        const now = Date.now();
        const diff = now - timestamp;
        const seconds = Math.floor(diff / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);

        if (seconds < 60) return 'just now';
        if (minutes < 60) return `${minutes}m ago`;
        if (hours < 24) return `${hours}h ago`;
        if (days < 7) return `${days}d ago`;

        // Format as date for older conversations
        const date = new Date(timestamp);
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }

    /**
     * Toggle pin conversation
     */
    togglePinConversation(id) {
        const conv = this.conversations[id];
        if (!conv) return;

        conv.pinned = !conv.pinned;
        conv.lastModified = Date.now();
        this.renderConversationsList();
        this.saveConversations();
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

                    // Download and cache Google Drive files (PDFs)
                    if (item.type === 'file' && item.file && item.file.file_data.startsWith('gdrive://')) {
                        try {
                            const gdriveUrl = item.file.file_data;
                            const dataURL = await this.storageManager.downloadArtifact(gdriveUrl);
                            // Store both: base64 for display/API, gdrive:// for storage
                            msg.content[j].file._gdriveUrl = gdriveUrl;
                            msg.content[j].file.file_data = dataURL;
                            console.log('Cached Google Drive file');
                        } catch (error) {
                            console.error('Failed to cache Google Drive file:', error);
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

        // Add event listeners for audio play buttons
        document.querySelectorAll('.audio-play-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                this.toggleAudioPlayback(btn);
            });
        });
    }

    /**
     * Toggle audio playback
     */
    toggleAudioPlayback(button) {
        const audioData = button.dataset.audio;
        if (!audioData) return;

        // Check if this audio is currently playing
        if (this.currentlyPlayingAudio && this.currentlyPlayingAudio.button === button) {
            // Stop playing
            this.currentlyPlayingAudio.audio.pause();
            this.currentlyPlayingAudio.audio.currentTime = 0;
            button.querySelector('.material-icons').textContent = 'play_arrow';
            button.classList.remove('playing');
            this.currentlyPlayingAudio = null;
        } else {
            // Stop any currently playing audio
            if (this.currentlyPlayingAudio) {
                this.currentlyPlayingAudio.audio.pause();
                this.currentlyPlayingAudio.audio.currentTime = 0;
                this.currentlyPlayingAudio.button.querySelector('.material-icons').textContent = 'play_arrow';
                this.currentlyPlayingAudio.button.classList.remove('playing');
            }

            // Create and play new audio
            const audio = new Audio(audioData);
            button.querySelector('.material-icons').textContent = 'pause';
            button.classList.add('playing');

            audio.addEventListener('ended', () => {
                button.querySelector('.material-icons').textContent = 'play_arrow';
                button.classList.remove('playing');
                this.currentlyPlayingAudio = null;
            });

            audio.addEventListener('error', (e) => {
                console.error('Audio playback error:', e);
                this.showNotification('Failed to play audio', 'error');
                button.querySelector('.material-icons').textContent = 'play_arrow';
                button.classList.remove('playing');
                this.currentlyPlayingAudio = null;
            });

            audio.play();
            this.currentlyPlayingAudio = { audio, button };
        }
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
                    ${this.renderMessageContent(content, msg.isTyping)}
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
    renderMessageContent(content, isTyping = false) {
        // Show typing indicator if message is being typed
        if (isTyping) {
            return '<div class="typing-indicator"><span></span><span></span><span></span></div>';
        }

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
                        // Generate filename
                        const timestamp = new Date().getTime();
                        const filename = `recording_${timestamp}.webm`;

                        html += `<div class="message-audio-container">
                            <div class="audio-icon">
                                <span class="material-icons">audiotrack</span>
                            </div>
                            <div class="audio-info">
                                <span class="audio-name">Audio Recording</span>
                                <div class="audio-actions">
                                    <button class="audio-play-btn" data-audio="${this.escapeHtml(data)}" title="Play">
                                        <span class="material-icons">play_arrow</span>
                                        Play
                                    </button>
                                    <a href="${this.escapeHtml(data)}" download="${this.escapeHtml(filename)}" class="audio-download">
                                        <span class="material-icons">download</span>
                                        Download
                                    </a>
                                </div>
                            </div>
                        </div>`;
                    } else {
                        html += `<div class="message-file-placeholder"><span class="material-icons">audiotrack</span> <em>Audio not available</em></div>`;
                    }
                } else if (item.type === 'file' && item.file) {
                    const data = item.file.file_data;
                    const filename = item.file.filename || 'document.pdf';
                    if (data && data !== '[File data not saved to conserve storage]' && data !== '[File upload in progress - not saved]') {
                        html += `<div class="message-document">
                            <div class="document-icon">
                                <span class="material-icons">picture_as_pdf</span>
                            </div>
                            <div class="document-info">
                                <span class="document-name">${this.escapeHtml(filename)}</span>
                                <a href="${this.escapeHtml(data)}" download="${this.escapeHtml(filename)}" class="document-download">
                                    <span class="material-icons">download</span>
                                    Download
                                </a>
                            </div>
                        </div>`;
                    } else {
                        html += `<div class="message-file-placeholder"><span class="material-icons">picture_as_pdf</span> <em>File not available</em></div>`;
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
            messageContent = [];

            // Only add text if user actually typed something
            if (text) {
                messageContent.push({ type: 'text', text: text });
            }

            // Add files - use local dataURL immediately, track pending uploads
            for (const file of this.selectedFiles) {
                // For Google Drive files, use gdrive:// URL directly (no download needed)
                // The backend will download from Google Drive when processing the chat request
                let dataURL = file.gdriveUrl || file.dataURL;
                let gdriveUrl = file.gdriveUrl || null;

                if (file.fileType.startsWith('image/')) {
                    const imageData = {
                        type: 'image_url',
                        image_url: { url: dataURL }
                    };
                    // Keep original gdrive URL for storage if available
                    if (gdriveUrl) {
                        imageData.image_url._gdriveUrl = gdriveUrl;
                    } else if (file.uploading) {
                        // Mark for future update when upload completes
                        imageData.image_url._uploadPending = file;
                    }
                    messageContent.push(imageData);
                } else if (file.fileType === 'application/pdf') {
                    const pdfData = {
                        type: 'file',
                        file: {
                            file_data: dataURL,
                            filename: file.fileName
                        }
                    };
                    // Keep original gdrive URL for storage if available
                    if (gdriveUrl) {
                        pdfData.file._gdriveUrl = gdriveUrl;
                    } else if (file.uploading) {
                        // Mark for future update when upload completes
                        pdfData.file._uploadPending = file;
                    }
                    messageContent.push(pdfData);
                } else if (file.fileType.startsWith('audio/')) {
                    const audioData = {
                        type: 'audio',
                        audio: { data: dataURL }
                    };
                    // Keep original gdrive URL for storage if available
                    if (gdriveUrl) {
                        audioData.audio._gdriveUrl = gdriveUrl;
                    } else if (file.uploading) {
                        // Mark for future update when upload completes
                        audioData.audio._uploadPending = file;
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

            // Note: Google Drive artifacts are sent as gdrive:// URLs
            // The backend will download and process them using the auth token from the header

            // Create assistant message placeholder with typing indicator
            const assistantMessage = {
                role: 'assistant',
                content: '',
                timestamp: Date.now(),
                isTyping: true  // Flag to show typing animation
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
                    'Content-Type': 'application/json',
                    'X-Google-Drive-Token': localStorage.getItem('gd_access_token') || ''
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
                                // Remove typing indicator on first content
                                if (assistantMessage.isTyping) {
                                    delete assistantMessage.isTyping;
                                }

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

        // Update button text and icon
        const sourceConfig = {
            'microphone': {
                label: 'Microphone',
                icon: 'mic'
            },
            'system': {
                label: 'System Audio',
                icon: 'volume_up'
            },
            'mixed': {
                label: 'Mic + System',
                icon: 'settings_voice'
            }
        };

        const config = sourceConfig[source] || sourceConfig['microphone'];
        const iconElement = this.audioSourceBtn.querySelector('#audio-source-icon');
        const labelElement = this.audioSourceBtn.querySelector('#audio-source-label');

        if (iconElement) iconElement.textContent = config.icon;
        if (labelElement) labelElement.textContent = config.label;

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
                // Video is required for system audio capture
                const displayStream = await navigator.mediaDevices.getDisplayMedia({
                    video: true,
                    audio: true
                });

                // Extract only audio tracks for recording
                const audioTracks = displayStream.getAudioTracks();
                if (audioTracks.length === 0) {
                    displayStream.getTracks().forEach(track => track.stop());
                    throw new Error('No system audio available');
                }

                // Create a new MediaStream with only audio tracks
                const audioOnlyStream = new MediaStream(audioTracks);

                // Stop video tracks to save resources
                displayStream.getVideoTracks().forEach(track => track.stop());

                return audioOnlyStream;

            case 'mixed':
                try {
                    // Get microphone stream
                    const micStream = await navigator.mediaDevices.getUserMedia({
                        audio: {
                            echoCancellation: true,
                            noiseSuppression: true,
                            autoGainControl: true
                        }
                    });

                    // Get system audio stream (video required for getDisplayMedia)
                    const displayStreamMixed = await navigator.mediaDevices.getDisplayMedia({
                        audio: true,
                        video: true
                    });

                    const systemAudioTracks = displayStreamMixed.getAudioTracks();

                    // If no system audio is available, fall back to microphone only
                    if (systemAudioTracks.length === 0) {
                        console.warn('No system audio available, using microphone only');
                        displayStreamMixed.getTracks().forEach(track => track.stop());
                        return micStream;
                    }

                    // Create Web Audio API context for mixing
                    const audioContext = new (window.AudioContext || window.webkitAudioContext)();

                    // Create audio sources
                    const micSource = audioContext.createMediaStreamSource(micStream);
                    const systemSource = audioContext.createMediaStreamSource(new MediaStream(systemAudioTracks));

                    // Create gain nodes for volume control
                    const micGain = audioContext.createGain();
                    const systemGain = audioContext.createGain();

                    // Set volumes (slightly reduce to prevent clipping)
                    micGain.gain.value = 0.7;
                    systemGain.gain.value = 0.8;

                    // Create destination for mixed audio
                    const destination = audioContext.createMediaStreamDestination();

                    // Connect the audio graph
                    micSource.connect(micGain);
                    micGain.connect(destination);

                    systemSource.connect(systemGain);
                    systemGain.connect(destination);

                    // Stop video tracks to save resources
                    displayStreamMixed.getVideoTracks().forEach(track => track.stop());

                    return destination.stream;
                } catch (error) {
                    console.warn('Failed to create mixed audio, falling back to microphone:', error);
                    return await navigator.mediaDevices.getUserMedia({
                        audio: {
                            echoCancellation: true,
                            noiseSuppression: true,
                            autoGainControl: true
                        }
                    });
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
            this.uploadedChunks = [];
            this.currentRecordingGDriveId = null;

            this.mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    this.audioChunks.push(event.data);
                }
            };

            this.mediaRecorder.onstop = () => {
                this.processRecording();
            };

            // Start recording with periodic data chunks (every 10 seconds)
            this.mediaRecorder.start(10000);
            this.isRecording = true;
            this.recordingStartTime = Date.now();

            // Update UI
            this.updateRecordingUI(true);
            this.startRecordingTimer();
            this.startAudioVisualization();

            // Start periodic upload to Google Drive (every 30 seconds)
            const syncStatus = this.storageManager.getSyncStatus();
            if (syncStatus.mode === 'online') {
                this.startPeriodicRecordingUpload();
            }

        } catch (error) {
            console.error('Failed to start recording:', error);
            this.showNotification(`Recording failed: ${error.message}`, 'error');
        }
    }

    /**
     * Start periodic recording upload to Google Drive
     */
    startPeriodicRecordingUpload() {
        // Upload accumulated chunks every 30 seconds
        this.recordingUploadInterval = setInterval(() => {
            this.uploadRecordingChunks();
        }, 30000);

        console.log('Started periodic recording upload (every 30s)');
    }

    /**
     * Upload accumulated recording chunks to Google Drive
     */
    async uploadRecordingChunks() {
        // Get new chunks that haven't been uploaded yet
        const newChunks = this.audioChunks.slice(this.uploadedChunks.length);

        if (newChunks.length === 0) {
            return; // Nothing new to upload
        }

        try {
            const syncStatus = this.storageManager.getSyncStatus();
            if (syncStatus.mode !== 'online') {
                console.log('Not online, skipping periodic upload');
                return;
            }

            // Create blob from new chunks
            const partialBlob = new Blob(newChunks, {
                type: this.mediaRecorder.mimeType
            });

            console.log(`Uploading ${newChunks.length} audio chunks (${this.formatFileSize(partialBlob.size)})...`);

            if (!this.currentRecordingGDriveId) {
                // First upload - create new file
                const timestamp = Date.now();
                const filename = `recording_${timestamp}_partial.${this.getFileExtension(this.mediaRecorder.mimeType)}`;

                const gdriveUrl = await this.storageManager.uploadArtifact(partialBlob, filename);
                this.currentRecordingGDriveId = gdriveUrl.replace('gdrive://', '');

                console.log(`Created recording file in Google Drive: ${gdriveUrl}`);
            } else {
                // Append to existing file
                // Note: Google Drive API doesn't support append, so we'll upload as new version
                // We'll merge all chunks on final stop
                console.log('Accumulated more chunks, will merge on stop');
            }

            // Mark these chunks as uploaded (moved to uploadedChunks)
            this.uploadedChunks.push(...newChunks);

            // Optional: Clear uploaded chunks from memory to save RAM
            // this.audioChunks = this.audioChunks.slice(this.uploadedChunks.length);

            console.log(`Uploaded chunks to Google Drive. Total uploaded: ${this.uploadedChunks.length}, Total recorded: ${this.audioChunks.length}`);

        } catch (error) {
            console.error('Failed to upload recording chunks:', error);
            // Don't show notification - we'll retry on next interval or final upload
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
            this.stopAudioVisualization();

            // Stop periodic upload timer
            if (this.recordingUploadInterval) {
                clearInterval(this.recordingUploadInterval);
                this.recordingUploadInterval = null;
            }

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

            // Clear audio chunks immediately to free memory
            this.audioChunks = [];

            const duration = Date.now() - this.recordingStartTime;
            const filename = `recording_${Date.now()}.${this.getFileExtension(this.mediaRecorder.mimeType)}`;

            // Check file size and determine processing strategy
            const fileSizeMB = audioBlob.size / 1024 / 1024;
            const isLargeFile = audioBlob.size >= this.GDRIVE_SIZE_THRESHOLD;
            console.log(`Audio recording size: ${fileSizeMB.toFixed(2)}MB, Large: ${isLargeFile}`);

            let dataURL;
            let gdriveUrl = null;
            const syncStatus = this.storageManager.getSyncStatus();

            // For large recordings (>= 5MB), upload to Google Drive first and use gdrive:// URL
            if (isLargeFile && syncStatus.mode === 'online') {
                console.log(`Large recording detected, uploading to Google Drive: ${filename}`);
                this.showNotification(`Uploading large recording (${fileSizeMB.toFixed(2)}MB) to Google Drive...`, 'info');

                try {
                    gdriveUrl = await this.storageManager.uploadArtifact(audioBlob, filename);
                    dataURL = gdriveUrl; // Use gdrive:// URL directly
                    console.log(`Recording uploaded to Google Drive: ${gdriveUrl}`);
                    this.showNotification(`Recording uploaded successfully`, 'success');
                } catch (uploadError) {
                    console.error('Failed to upload recording to Google Drive:', uploadError);
                    throw new Error(
                        `Failed to upload large recording to Google Drive: ${uploadError.message}. ` +
                        `Please check your connection and Google Drive permissions.`
                    );
                }
            } else if (isLargeFile && syncStatus.mode !== 'online') {
                // Large recording but offline - reject
                throw new Error(
                    `Recording too large (${fileSizeMB.toFixed(2)}MB) for offline mode. ` +
                    `Please connect to Google Drive or record a shorter clip.`
                );
            } else {
                // Small recording (< 5MB) - use base64 as before
                try {
                    dataURL = await this.blobToDataURL(audioBlob);
                } catch (encodingError) {
                    console.error('Failed to encode audio to base64:', encodingError);
                    throw new Error(
                        `Failed to encode audio file (${fileSizeMB.toFixed(2)}MB). ` +
                        `The file may be too large for your browser to process. ` +
                        `Try recording a shorter clip or refresh the page.`
                    );
                }
            }

            const fileObj = {
                fileName: filename,
                fileType: this.mediaRecorder.mimeType,
                fileSize: audioBlob.size,
                dataURL: dataURL,
                gdriveUrl: gdriveUrl,
                isArtifact: gdriveUrl ? true : false,
                uploading: false,
                source: gdriveUrl ? 'gdrive' : 'local'
            };

            this.selectedFiles.push(fileObj);
            this.renderFilePreview();

            // Clean up streaming state
            this.uploadedChunks = [];
            this.currentRecordingGDriveId = null;

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
            this.audioSourceBtn.classList.add('recording');
        } else {
            this.recordBtn.classList.remove('hidden');
            this.stopRecordBtn.classList.add('hidden');
            this.segmentBtn.classList.add('hidden');
            this.recordingIndicator.classList.add('hidden');
            this.audioSourceBtn.classList.remove('recording');
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
     * Start audio visualization
     */
    startAudioVisualization() {
        if (!this.audioStream || !this.audioVisualizer) {
            return;
        }

        try {
            // Create audio context if not exists
            if (!this.audioContext) {
                this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            }

            // Create analyser node
            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = 256;
            this.analyser.smoothingTimeConstant = 0.8;

            // Connect audio stream to analyser
            const source = this.audioContext.createMediaStreamSource(this.audioStream);
            source.connect(this.analyser);

            // Start visualization loop
            this.drawAudioVisualization();

            console.log('Audio visualization started');
        } catch (error) {
            console.error('Failed to start audio visualization:', error);
        }
    }

    /**
     * Draw audio visualization on canvas
     */
    drawAudioVisualization() {
        if (!this.analyser || !this.audioVisualizer) {
            return;
        }

        const canvas = this.audioVisualizer;
        const ctx = canvas.getContext('2d');
        const bufferLength = this.analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);

        const draw = () => {
            if (!this.isRecording) {
                return;
            }

            this.visualizerAnimationId = requestAnimationFrame(draw);

            // Get frequency data
            this.analyser.getByteFrequencyData(dataArray);

            // Clear canvas
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            // Draw bars
            const barCount = 16;
            const barWidth = canvas.width / barCount;
            const barSpacing = 2;

            for (let i = 0; i < barCount; i++) {
                // Sample frequency data
                const dataIndex = Math.floor(i * bufferLength / barCount);
                const value = dataArray[dataIndex];

                // Normalize to canvas height (0-1)
                const normalizedValue = value / 255;

                // Calculate bar height with minimum height
                const minHeight = 4;
                const barHeight = Math.max(minHeight, normalizedValue * canvas.height);

                // Calculate bar position (centered vertically)
                const x = i * barWidth + barSpacing / 2;
                const y = canvas.height - barHeight;

                // Draw bar with gradient (turquoise to white)
                const gradient = ctx.createLinearGradient(0, canvas.height, 0, 0);
                gradient.addColorStop(0, '#00D2DD'); // turquoise
                gradient.addColorStop(0.5, '#3CD7E0'); // turquoise-90
                gradient.addColorStop(1, '#FFFFFF'); // white

                ctx.fillStyle = gradient;
                ctx.fillRect(x, y, barWidth - barSpacing, barHeight);
            }
        };

        draw();
    }

    /**
     * Stop audio visualization
     */
    stopAudioVisualization() {
        // Cancel animation frame
        if (this.visualizerAnimationId) {
            cancelAnimationFrame(this.visualizerAnimationId);
            this.visualizerAnimationId = null;
        }

        // Clear canvas
        if (this.audioVisualizer) {
            const ctx = this.audioVisualizer.getContext('2d');
            ctx.clearRect(0, 0, this.audioVisualizer.width, this.audioVisualizer.height);
        }

        // Disconnect analyser
        if (this.analyser) {
            this.analyser.disconnect();
            this.analyser = null;
        }

        // Note: We don't close audioContext here as it might be reused
        // It will be cleaned up when the page unloads
    }

    /**
     * Handle file selection
     */
    async handleFileSelection(files) {
        for (const file of files) {
            // Accept all image formats, PDFs, and audio
            if (file.type.startsWith('image/') ||
                file.type === 'application/pdf' ||
                file.type.startsWith('audio/')) {

                try {
                    const isAudio = file.type.startsWith('audio/');
                    const isImage = file.type.startsWith('image/');
                    const isPDF = file.type === 'application/pdf';

                    const fileSizeMB = file.size / 1024 / 1024;
                    const isLargeFile = file.size >= this.GDRIVE_SIZE_THRESHOLD;

                    console.log(`File: ${file.name}, Size: ${fileSizeMB.toFixed(2)}MB, Large: ${isLargeFile}`);

                    let dataURL;
                    let gdriveUrl = null;
                    const syncStatus = this.storageManager.getSyncStatus();

                    // For large files (>= 5MB), upload to Google Drive first and use gdrive:// URL
                    if (isLargeFile && syncStatus.mode === 'online') {
                        console.log(`Large file detected, uploading to Google Drive: ${file.name}`);
                        this.showNotification(`Uploading large file (${fileSizeMB.toFixed(2)}MB) to Google Drive...`, 'info');

                        try {
                            gdriveUrl = await this.storageManager.uploadArtifact(file, file.name);
                            dataURL = gdriveUrl; // Use gdrive:// URL directly
                            console.log(`File uploaded to Google Drive: ${gdriveUrl}`);
                            this.showNotification(`File uploaded successfully`, 'success');
                        } catch (uploadError) {
                            console.error('Failed to upload to Google Drive:', uploadError);
                            throw new Error(
                                `Failed to upload large file to Google Drive: ${uploadError.message}. ` +
                                `Please check your connection and Google Drive permissions.`
                            );
                        }
                    } else if (isLargeFile && syncStatus.mode !== 'online') {
                        // Large file but offline - reject
                        throw new Error(
                            `File too large (${fileSizeMB.toFixed(2)}MB) for offline mode. ` +
                            `Please connect to Google Drive to upload large files.`
                        );
                    } else {
                        // Small file (< 5MB) - use base64 as before
                        try {
                            dataURL = await this.fileToDataURL(file);
                        } catch (encodingError) {
                            console.error('Failed to encode file to base64:', encodingError);
                            throw new Error(
                                `Failed to encode ${file.name} (${fileSizeMB.toFixed(2)}MB). ` +
                                `The file may be too large for your browser to process.`
                            );
                        }
                    }

                    const fileObj = {
                        fileName: file.name,
                        fileType: file.type,
                        fileSize: file.size,
                        dataURL: dataURL,
                        gdriveUrl: gdriveUrl,
                        isArtifact: gdriveUrl ? true : false,
                        uploading: false,
                        source: gdriveUrl ? 'gdrive' : 'local'
                    };

                    this.selectedFiles.push(fileObj);
                    this.renderFilePreview();

                } catch (error) {
                    console.error('File processing error:', error);
                    this.showNotification(`Failed to process ${file.name}`, 'error');
                }
            }
        }
    }

    /**
     * Upload file to Google Drive in background (non-blocking)
     */
    async uploadToGoogleDriveInBackground(file, fileObj) {
        try {
            // Handle both File and Blob objects
            const filename = file.name || fileObj.fileName;
            const gdriveUrl = await this.storageManager.uploadArtifact(file, filename);

            // Update file object with Google Drive URL
            fileObj.gdriveUrl = gdriveUrl;
            fileObj.isArtifact = true;
            fileObj.uploading = false;
            fileObj.source = 'gdrive';

            console.log('File uploaded to Google Drive:', gdriveUrl);

            // Update any messages that were sent while this file was uploading
            this.updatePendingUploads(fileObj, gdriveUrl);

            // Re-render to update badge
            this.renderFilePreview();
        } catch (error) {
            console.warn('Google Drive upload failed:', error.message);
            fileObj.uploading = false;
            fileObj.uploadError = true;
            fileObj.temporary = true;
            this.showNotification(`Upload failed: ${fileObj.fileName}`, 'warning');
            this.renderFilePreview();
        }
    }

    /**
     * Update messages with pending uploads when upload completes
     */
    updatePendingUploads(fileObj, gdriveUrl) {
        let updated = false;

        for (const msg of this.messages) {
            if (Array.isArray(msg.content)) {
                for (const item of msg.content) {
                    // Update images
                    if (item.type === 'image_url' && item.image_url?._uploadPending === fileObj) {
                        item.image_url._gdriveUrl = gdriveUrl;
                        delete item.image_url._uploadPending;
                        updated = true;
                    }
                    // Update audio
                    if (item.type === 'audio' && item.audio?._uploadPending === fileObj) {
                        item.audio._gdriveUrl = gdriveUrl;
                        delete item.audio._uploadPending;
                        updated = true;
                    }
                    // Update files (PDFs)
                    if (item.type === 'file' && item.file?._uploadPending === fileObj) {
                        item.file._gdriveUrl = gdriveUrl;
                        delete item.file._uploadPending;
                        updated = true;
                    }
                }
            }
        }

        // Save conversation if we updated any messages
        if (updated) {
            console.log('Updated pending uploads with Google Drive URL');
            this.saveConversations();
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

            if (file.uploading) {
                badge = '<span class="artifact-badge" style="background-color: var(--turquoise);">UPLOADING...</span>';
            } else if (file.isArtifact) {
                badge = '<span class="artifact-badge">GDRIVE</span>';
            } else if (file.uploadError) {
                badge = '<span class="artifact-badge" style="background-color: var(--error-color);">ERROR</span>';
            } else if (file.temporary) {
                badge = '<span class="artifact-badge" style="background-color: var(--warning-color);">TEMP</span>';
            }

            // Show thumbnail/icon based on file type
            let thumbnail = '';
            if (file.fileType.startsWith('image/')) {
                // Always use the local dataURL for preview (instant display)
                let imageUrl = file.dataURL;

                if (imageUrl && !imageUrl.startsWith('gdrive://')) {
                    thumbnail = `<img src="${this.escapeHtml(imageUrl)}" alt="${this.escapeHtml(file.fileName)}" class="file-preview-thumbnail" />`;
                } else {
                    thumbnail = `<div class="file-preview-thumbnail-placeholder"><span class="material-icons">image</span></div>`;
                }
            } else if (file.fileType === 'application/pdf') {
                // Show PDF icon
                thumbnail = `<div class="file-preview-thumbnail-placeholder" style="background-color: var(--error-color);"><span class="material-icons" style="color: white;">picture_as_pdf</span></div>`;
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
     * Export conversation (local download)
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
     * Export conversation to Google Docs
     */
    async exportConversationToGoogleDocs() {
        if (!this.currentConversationId) {
            this.showNotification('No conversation to export', 'warning');
            return;
        }

        // Check if online
        const syncStatus = this.storageManager.getSyncStatus();
        if (syncStatus.mode !== 'online') {
            this.showNotification('Please connect to Google Drive first', 'warning');
            return;
        }

        const conversation = this.conversations[this.currentConversationId];

        try {
            this.showNotification('Creating Google Doc...', 'info', { duration: 3000 });

            // Get markdown export
            let result;
            if (this.workerReady) {
                result = await this.workerManager.exportConversationAsMarkdown(conversation);
            } else {
                // Fallback - simple text export
                const content = JSON.stringify(conversation, null, 2);
                result = {
                    success: true,
                    data: { content }
                };
            }

            if (!result.success) {
                throw new Error('Failed to generate markdown');
            }

            let markdown = result.data.content;

            // Handle gdrive:// image references - replace with placeholders
            markdown = this.convertGDriveReferencesForExport(markdown);

            // Upload to Google Docs
            const docInfo = await this.storageManager.exportToGoogleDocs(
                markdown,
                conversation.title
            );

            // Show success notification with link to the doc
            this.showNotification('Google Doc created successfully!', 'success', {
                link: docInfo.url,
                linkText: 'Open Google Doc',
                duration: 15000 // 15 seconds for user to click link
            });

        } catch (error) {
            console.error('Export to Google Docs failed:', error);
            this.showNotification(`Failed to create Google Doc: ${error.message}`, 'error');
        }
    }

    /**
     * Convert gdrive:// references for export (replace with placeholders or URLs)
     */
    convertGDriveReferencesForExport(markdown) {
        // Replace image references with placeholders
        // Format: ![alt text](gdrive://FILE_ID) -> [Image: alt text]
        markdown = markdown.replace(/!\[([^\]]*)\]\(gdrive:\/\/[^\)]+\)/g, '[Image: $1]');

        // Could also handle audio/file references if needed
        return markdown;
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
     * Show notification toast
     * @param {string} message - The notification message
     * @param {string} type - Type: 'success', 'error', 'warning', 'info'
     * @param {Object} options - Optional: { link: 'url', linkText: 'text', duration: milliseconds }
     */
    showNotification(message, type = 'info', options = {}) {
        console.log(`[${type.toUpperCase()}] ${message}`);

        // Create notification element
        const toast = document.createElement('div');
        toast.className = `notification-toast ${type}`;

        // Icon based on type
        const icons = {
            success: 'check_circle',
            error: 'error',
            warning: 'warning',
            info: 'info'
        };

        const icon = icons[type] || icons['info'];

        // Build notification HTML
        let html = `
            <div class="notification-icon">
                <span class="material-icons">${icon}</span>
            </div>
            <div class="notification-content">
                <div class="notification-message">${this.escapeHtml(message)}</div>
        `;

        // Add link if provided
        if (options.link) {
            const linkText = options.linkText || 'Open';
            html += `
                <a href="${this.escapeHtml(options.link)}" target="_blank" class="notification-link">
                    <span class="material-icons">open_in_new</span>
                    ${this.escapeHtml(linkText)}
                </a>
            `;
        }

        html += `
            </div>
            <button class="notification-close">
                <span class="material-icons">close</span>
            </button>
        `;

        toast.innerHTML = html;

        // Add to container
        this.notificationContainer.appendChild(toast);

        // Close button handler
        const closeBtn = toast.querySelector('.notification-close');
        closeBtn.addEventListener('click', () => {
            this.removeNotification(toast);
        });

        // Auto-dismiss after duration (default: 5 seconds, longer for links)
        const duration = options.duration || (options.link ? 10000 : 5000);
        setTimeout(() => {
            this.removeNotification(toast);
        }, duration);
    }

    /**
     * Remove notification with animation
     */
    removeNotification(toast) {
        if (!toast || !toast.parentNode) return;

        toast.classList.add('removing');
        setTimeout(() => {
            if (toast.parentNode) {
                toast.parentNode.removeChild(toast);
            }
        }, 300); // Match animation duration
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
