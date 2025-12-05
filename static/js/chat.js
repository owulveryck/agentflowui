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

        // Slash commands state
        this.slashCommandsVisible = false;
        this.selectedCommandIndex = 0;
        this.filteredCommands = [];

        // Voice input state
        this.recognition = null;
        this.isListening = false;

        // Templates state
        this.templates = [];

        // Folders state
        this.folders = [];
        this.selectedFolderId = 'all'; // 'all' or folder id

        // Tags state
        this.availableTags = [];
        this.selectedTagFilter = null; // null or tag name

        // Advanced search filters state
        this.searchFilters = {
            date: 'all', // all, today, week, month
            messages: 'all' // all, short (1-5), medium (6-20), long (20+)
        };

        // Bulk operations state
        this.bulkMode = false;
        this.selectedConversations = new Set();

        // Constants
        this.FILE_SIZE_THRESHOLD = 25 * 1024; // 25KB
        this.AUDIO_SIZE_THRESHOLD = 500 * 1024; // 500KB
        this.AUDIO_DURATION_THRESHOLD = 30 * 1000; // 30 seconds
    }

    /**
     * Get available slash commands
     */
    getSlashCommands() {
        return [
            {
                name: '/summarize',
                icon: 'summarize',
                description: 'Summarize the conversation so far',
                action: 'template',
                template: 'Please provide a concise summary of our conversation so far, highlighting the key points and decisions.'
            },
            {
                name: '/translate',
                icon: 'translate',
                description: 'Translate the last message to another language',
                action: 'template',
                template: 'Please translate the last message to [language]:\n\n'
            },
            {
                name: '/explain',
                icon: 'school',
                description: 'Explain the last response in simpler terms',
                action: 'template',
                template: 'Please explain your last response in simpler terms, as if explaining to someone without technical knowledge.'
            },
            {
                name: '/code',
                icon: 'code',
                description: 'Generate code based on requirements',
                action: 'template',
                template: 'Please write code for the following:\n\n'
            },
            {
                name: '/debug',
                icon: 'bug_report',
                description: 'Help debug code or find issues',
                action: 'template',
                template: 'Please help me debug this code and identify any issues:\n\n```\n\n```'
            },
            {
                name: '/review',
                icon: 'rate_review',
                description: 'Review code for best practices and improvements',
                action: 'template',
                template: 'Please review this code and suggest improvements:\n\n```\n\n```'
            },
            {
                name: '/improve',
                icon: 'auto_fix_high',
                description: 'Suggest improvements for the conversation topic',
                action: 'template',
                template: 'Based on what we\'ve discussed, please suggest improvements or next steps.'
            },
            {
                name: '/eli5',
                icon: 'child_care',
                description: 'Explain like I\'m 5 years old',
                action: 'template',
                template: 'Please explain this concept as if I\'m 5 years old: '
            },
            {
                name: '/pros-cons',
                icon: 'compare',
                description: 'List pros and cons of a topic',
                action: 'template',
                template: 'Please provide a detailed pros and cons list for: '
            },
            {
                name: '/brainstorm',
                icon: 'lightbulb',
                description: 'Brainstorm ideas on a topic',
                action: 'template',
                template: 'Let\'s brainstorm creative ideas for: '
            }
        ];
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

            // ?: Show keyboard shortcuts help
            if (e.key === '?' && !e.ctrlKey && !e.metaKey && !e.altKey) {
                // Only if not typing in input
                if (document.activeElement !== this.userInput &&
                    document.activeElement.tagName !== 'TEXTAREA' &&
                    document.activeElement.tagName !== 'INPUT') {
                    e.preventDefault();
                    this.showKeyboardShortcutsHelp();
                }
            }

            // Escape: Close all dropdowns, modals, and collapse menu on mobile
            if (e.key === 'Escape') {
                this.modelDropdown.classList.add('hidden');
                this.audioSourceDropdown.classList.add('hidden');
                this.settingsDropdown.classList.add('hidden');

                // Close keyboard shortcuts modal
                if (this.keyboardShortcutsModal) {
                    this.keyboardShortcutsModal.classList.add('hidden');
                }

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

        // Keyboard shortcuts modal
        this.keyboardShortcutsModal = document.getElementById('keyboard-shortcuts-modal');

        // Trim audio modal
        this.trimAudioModal = document.getElementById('trim-audio-modal');
        this.trimWaveform = document.getElementById('trim-waveform');
        this.trimRegion = document.getElementById('trim-region');
        this.trimHandleStart = document.getElementById('trim-handle-start');
        this.trimHandleEnd = document.getElementById('trim-handle-end');
        this.trimStartTime = document.getElementById('trim-start-time');
        this.trimEndTime = document.getElementById('trim-end-time');
        this.trimDuration = document.getElementById('trim-duration');
        this.trimPlayBtn = document.getElementById('trim-play-btn');
        this.trimCancelBtn = document.getElementById('trim-cancel-btn');
        this.trimApplyBtn = document.getElementById('trim-apply-btn');
        this.trimModalClose = document.getElementById('trim-modal-close');

        // Trim state
        this.trimFileIndex = null;
        this.trimAudioBuffer = null;
        this.trimAudioContext = null;
        this.trimAudioSource = null;
        this.trimStartPercent = 0;
        this.trimEndPercent = 100;
        this.trimDragging = null;

        // Dark mode toggle
        this.darkModeToggle = document.getElementById('dark-mode-toggle');

        // Markdown toolbar
        this.markdownToolbar = document.getElementById('markdown-toolbar');

        // Slash commands
        this.slashCommandsDropdown = document.getElementById('slash-commands-dropdown');
        this.slashCommandsList = document.getElementById('slash-commands-list');

        // Voice input
        this.voiceInputBtn = document.getElementById('voice-input-btn');

        // Templates
        this.templatesBtn = document.getElementById('templates-btn');
        this.templatesDropdown = document.getElementById('templates-dropdown');
        this.templatesList = document.getElementById('templates-list');
        this.saveTemplateBtn = document.getElementById('save-template-btn');
        this.manageTemplatesBtn = document.getElementById('manage-templates-btn');

        // Character/Token counter
        this.charCountValue = document.getElementById('char-count-value');
        this.tokenCountValue = document.getElementById('token-count-value');

        // Folders
        this.foldersList = document.getElementById('folders-list');
        this.addFolderBtn = document.getElementById('add-folder-btn');
        this.allFolderCount = document.getElementById('all-folder-count');

        // Tags
        this.tagsFilterList = document.getElementById('tags-filter-list');
        this.clearTagFilterBtn = document.getElementById('clear-tag-filter');

        // Advanced search filters
        this.searchFiltersBtn = document.getElementById('search-filters-btn');
        this.searchFiltersPanel = document.getElementById('search-filters');
        this.clearAllFiltersBtn = document.getElementById('clear-all-filters');

        // Bulk operations
        this.enableBulkModeBtn = document.getElementById('enable-bulk-mode-btn');
        this.bulkActionsToolbar = document.getElementById('bulk-actions-toolbar');
        this.selectAllCheckbox = document.getElementById('select-all-conversations');
        this.bulkSelectionCount = document.getElementById('bulk-selection-count');
        this.bulkMoveBtn = document.getElementById('bulk-move-btn');
        this.bulkTagBtn = document.getElementById('bulk-tag-btn');
        this.bulkExportBtn = document.getElementById('bulk-export-btn');
        this.bulkDeleteBtn = document.getElementById('bulk-delete-btn');
        this.cancelBulkBtn = document.getElementById('cancel-bulk-btn');
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

        // Drag and drop file upload
        this.chatMessages.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.chatMessages.classList.add('drag-over');
        });

        this.chatMessages.addEventListener('dragleave', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.chatMessages.classList.remove('drag-over');
        });

        this.chatMessages.addEventListener('drop', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.chatMessages.classList.remove('drag-over');

            const files = Array.from(e.dataTransfer.files);
            if (files.length > 0) {
                this.handleFileSelection(files);
                this.showNotification(`${files.length} file(s) added`, 'success');
            }
        });

        // Paste images from clipboard
        document.addEventListener('paste', (e) => {
            // Only handle paste when not in input/textarea or when focused on message input
            if (document.activeElement === this.userInput ||
                (document.activeElement.tagName !== 'INPUT' &&
                 document.activeElement.tagName !== 'TEXTAREA')) {

                const items = e.clipboardData?.items;
                if (!items) return;

                const files = [];
                for (let i = 0; i < items.length; i++) {
                    if (items[i].kind === 'file') {
                        const file = items[i].getAsFile();
                        if (file) {
                            files.push(file);
                        }
                    }
                }

                if (files.length > 0) {
                    e.preventDefault();
                    this.handleFileSelection(files);
                    this.showNotification(`${files.length} file(s) pasted`, 'success');

                    // Focus input after pasting files
                    this.userInput.focus();
                }
            }
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

        // Keyboard shortcuts modal close
        if (this.keyboardShortcutsModal) {
            const modalClose = this.keyboardShortcutsModal.querySelector('.modal-close');
            const modalBackdrop = this.keyboardShortcutsModal.querySelector('.modal-backdrop');

            if (modalClose) {
                modalClose.addEventListener('click', () => {
                    this.keyboardShortcutsModal.classList.add('hidden');
                });
            }

            if (modalBackdrop) {
                modalBackdrop.addEventListener('click', () => {
                    this.keyboardShortcutsModal.classList.add('hidden');
                });
            }
        }

        // Trim audio modal
        if (this.trimAudioModal) {
            const modalBackdrop = this.trimAudioModal.querySelector('.modal-backdrop');

            if (this.trimModalClose) {
                this.trimModalClose.addEventListener('click', () => {
                    this.closeTrimModal();
                });
            }

            if (modalBackdrop) {
                modalBackdrop.addEventListener('click', () => {
                    this.closeTrimModal();
                });
            }

            if (this.trimCancelBtn) {
                this.trimCancelBtn.addEventListener('click', () => {
                    this.closeTrimModal();
                });
            }

            if (this.trimApplyBtn) {
                this.trimApplyBtn.addEventListener('click', () => {
                    this.applyTrim();
                });
            }

            if (this.trimPlayBtn) {
                this.trimPlayBtn.addEventListener('click', () => {
                    this.previewTrimmedAudio();
                });
            }

            // Trim handle drag events
            if (this.trimHandleStart) {
                this.trimHandleStart.addEventListener('mousedown', (e) => {
                    e.preventDefault();
                    this.trimDragging = 'start';
                });
            }

            if (this.trimHandleEnd) {
                this.trimHandleEnd.addEventListener('mousedown', (e) => {
                    e.preventDefault();
                    this.trimDragging = 'end';
                });
            }

            // Global mouse move and up for dragging
            document.addEventListener('mousemove', (e) => {
                if (this.trimDragging && this.trimRegion) {
                    this.handleTrimDrag(e);
                }
            });

            document.addEventListener('mouseup', () => {
                this.trimDragging = null;
            });
        }

        // Dark mode toggle
        if (this.darkModeToggle) {
            this.darkModeToggle.addEventListener('click', () => {
                this.toggleDarkMode();
            });

            // Initialize dark mode from localStorage or system preference
            this.initializeDarkMode();
        }

        // Markdown toolbar
        if (this.markdownToolbar) {
            // Show/hide toolbar on input focus/blur
            this.userInput.addEventListener('focus', () => {
                this.markdownToolbar.classList.remove('hidden');
            });

            // Don't hide immediately on blur - let clicks register first
            this.userInput.addEventListener('blur', () => {
                setTimeout(() => {
                    if (document.activeElement !== this.userInput) {
                        this.markdownToolbar.classList.add('hidden');
                    }
                }, 200);
            });

            // Toolbar button clicks
            document.querySelectorAll('.toolbar-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.preventDefault();
                    const format = btn.dataset.format;
                    this.applyMarkdownFormat(format);
                    this.userInput.focus();
                });
            });
        }

        // Slash commands detection
        this.userInput.addEventListener('input', (e) => {
            this.handleSlashCommandInput();
        });

        // Slash commands keyboard navigation
        this.userInput.addEventListener('keydown', (e) => {
            if (this.slashCommandsVisible) {
                if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    this.navigateSlashCommands('down');
                } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    this.navigateSlashCommands('up');
                } else if (e.key === 'Enter' && this.filteredCommands.length > 0) {
                    e.preventDefault();
                    this.executeSlashCommand(this.filteredCommands[this.selectedCommandIndex]);
                } else if (e.key === 'Escape') {
                    e.preventDefault();
                    this.hideSlashCommands();
                }
            }
        });

        // Voice input
        this.voiceInputBtn.addEventListener('click', () => {
            this.toggleVoiceInput();
        });

        // Initialize speech recognition if supported
        this.initializeSpeechRecognition();

        // Templates
        this.templatesBtn.addEventListener('click', () => {
            this.templatesDropdown.classList.toggle('hidden');
        });

        this.saveTemplateBtn.addEventListener('click', () => {
            this.saveCurrentAsTemplate();
            this.templatesDropdown.classList.add('hidden');
        });

        this.manageTemplatesBtn.addEventListener('click', () => {
            this.manageTemplates();
            this.templatesDropdown.classList.add('hidden');
        });

        // Close templates dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (!this.templatesBtn.contains(e.target) && !this.templatesDropdown.contains(e.target)) {
                this.templatesDropdown.classList.add('hidden');
            }
        });

        // Load templates from localStorage
        this.loadTemplates();

        // Load folders from localStorage
        this.loadFolders();

        // Folder management
        this.addFolderBtn.addEventListener('click', () => {
            this.createFolder();
        });

        // Folder selection (delegated)
        document.addEventListener('click', (e) => {
            const folderItem = e.target.closest('.folder-item');
            if (folderItem && !e.target.closest('.folder-action-btn')) {
                const folderId = folderItem.dataset.folder;
                this.selectFolder(folderId);
            }
        });

        // Initialize tags
        this.updateAvailableTags();
        this.renderTagsFilter();

        // Clear tag filter
        this.clearTagFilterBtn.addEventListener('click', () => {
            this.clearTagFilter();
        });

        // Character/Token counter update
        this.userInput.addEventListener('input', () => {
            this.updateCharTokenCounter();
        });

        // Initialize counter
        this.updateCharTokenCounter();

        // Advanced search filters
        if (this.searchFiltersBtn) {
            this.searchFiltersBtn.addEventListener('click', () => {
                this.toggleSearchFilters();
            });
        }

        // Filter buttons
        document.querySelectorAll('.filter-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const filterType = btn.dataset.filter;
                const filterValue = btn.dataset.value;
                this.applyFilter(filterType, filterValue);
            });
        });

        // Clear all filters
        if (this.clearAllFiltersBtn) {
            this.clearAllFiltersBtn.addEventListener('click', () => {
                this.clearAllFilters();
            });
        }

        // Bulk operations
        if (this.enableBulkModeBtn) {
            this.enableBulkModeBtn.addEventListener('click', () => {
                if (this.bulkMode) {
                    this.exitBulkMode();
                } else {
                    this.enterBulkMode();
                }
            });
        }

        if (this.selectAllCheckbox) {
            this.selectAllCheckbox.addEventListener('change', (e) => {
                this.toggleSelectAll(e.target.checked);
            });
        }

        if (this.bulkMoveBtn) {
            this.bulkMoveBtn.addEventListener('click', () => {
                this.bulkMoveToFolder();
            });
        }

        if (this.bulkTagBtn) {
            this.bulkTagBtn.addEventListener('click', () => {
                this.bulkAddTag();
            });
        }

        if (this.bulkExportBtn) {
            this.bulkExportBtn.addEventListener('click', () => {
                this.bulkExport();
            });
        }

        if (this.bulkDeleteBtn) {
            this.bulkDeleteBtn.addEventListener('click', () => {
                this.bulkDelete();
            });
        }

        if (this.cancelBulkBtn) {
            this.cancelBulkBtn.addEventListener('click', () => {
                this.exitBulkMode();
            });
        }
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
        this.updateFolderCounts();

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
        this.updateFolderCounts();
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

        // Filter by folder
        let filtered = conversationIds.filter(id => {
            const conv = this.conversations[id];

            // If "All Conversations" is selected, show all
            if (this.selectedFolderId === 'all') {
                return true;
            }

            // Otherwise, only show conversations in the selected folder
            return conv.folderId === this.selectedFolderId;
        });

        // Filter by tag
        if (this.selectedTagFilter) {
            filtered = filtered.filter(id => {
                const conv = this.conversations[id];
                return conv.tags && conv.tags.includes(this.selectedTagFilter);
            });
        }

        // Filter by search query
        filtered = filtered.filter(id => {
            const conv = this.conversations[id];
            if (!this.searchQuery) return true;

            const titleMatch = conv.title.toLowerCase().includes(this.searchQuery);
            const messagesMatch = conv.messages && conv.messages.some(msg => {
                const content = typeof msg.content === 'string' ? msg.content : '';
                return content.toLowerCase().includes(this.searchQuery);
            });

            return titleMatch || messagesMatch;
        });

        // Filter by date range
        if (this.searchFilters.date !== 'all') {
            filtered = filtered.filter(id => {
                const conv = this.conversations[id];
                const convDate = new Date(conv.lastModified || conv.createdAt || 0);
                const now = new Date();

                switch (this.searchFilters.date) {
                    case 'today':
                        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                        return convDate >= today;

                    case 'week':
                        const weekAgo = new Date(now);
                        weekAgo.setDate(weekAgo.getDate() - 7);
                        return convDate >= weekAgo;

                    case 'month':
                        const monthAgo = new Date(now);
                        monthAgo.setMonth(monthAgo.getMonth() - 1);
                        return convDate >= monthAgo;

                    default:
                        return true;
                }
            });
        }

        // Filter by message count
        if (this.searchFilters.messages !== 'all') {
            filtered = filtered.filter(id => {
                const conv = this.conversations[id];
                const messageCount = conv.messages ? conv.messages.length : 0;

                switch (this.searchFilters.messages) {
                    case 'short':
                        return messageCount >= 1 && messageCount <= 5;

                    case 'medium':
                        return messageCount >= 6 && messageCount <= 20;

                    case 'long':
                        return messageCount > 20;

                    default:
                        return true;
                }
            });
        }

        if (filtered.length === 0) {
            const folderName = this.selectedFolderId === 'all' ? '' :
                `in ${this.folders.find(f => f.id === this.selectedFolderId)?.name || 'this folder'} `;
            const tagName = this.selectedTagFilter ? `with tag "${this.selectedTagFilter}" ` : '';

            // Add date filter info
            let dateFilter = '';
            if (this.searchFilters.date !== 'all') {
                const dateLabels = {
                    today: 'from today',
                    week: 'from this week',
                    month: 'from this month'
                };
                dateFilter = dateLabels[this.searchFilters.date] || '';
            }

            // Add message count filter info
            let messageFilter = '';
            if (this.searchFilters.messages !== 'all') {
                const messageLabels = {
                    short: 'with 1-5 messages',
                    medium: 'with 6-20 messages',
                    long: 'with 20+ messages'
                };
                messageFilter = messageLabels[this.searchFilters.messages] || '';
            }

            const activeFilters = [tagName, folderName, dateFilter, messageFilter].filter(f => f).join(' ');
            this.conversationsList.innerHTML = `<div class="empty-state">No conversations found ${activeFilters}<br><small>${this.searchQuery ? 'Try a different search' : activeFilters ? 'Try clearing some filters' : 'Start a new conversation'}</small></div>`;
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

                // Check if conversation is selected (bulk mode)
                const isSelected = this.selectedConversations.has(id);

                // Render tags
                let tagsHtml = '';
                if (conv.tags && conv.tags.length > 0) {
                    tagsHtml = '<div class="conversation-tags">';
                    conv.tags.forEach(tag => {
                        tagsHtml += `
                            <span class="tag-pill" data-tag="${this.escapeHtml(tag)}" data-conv-id="${id}">
                                ${this.escapeHtml(tag)}
                                <span class="material-icons tag-remove" title="Remove tag">close</span>
                            </span>
                        `;
                    });
                    tagsHtml += '</div>';
                }

                // Add checkbox in bulk mode
                const checkboxHtml = this.bulkMode ?
                    `<input type="checkbox" class="conversation-checkbox" data-id="${id}" ${isSelected ? 'checked' : ''}>` : '';

                html += `
                    <div class="conversation-item ${isActive ? 'active' : ''} ${isPinned ? 'pinned' : ''} ${this.bulkMode ? 'bulk-mode' : ''} ${isSelected ? 'selected' : ''}" data-id="${id}">
                        ${checkboxHtml}
                        <div class="conversation-content">
                            <div class="conversation-title">
                                ${isPinned ? '<span class="material-icons pin-indicator">push_pin</span>' : ''}
                                ${this.escapeHtml(conv.title)}
                            </div>
                            <div class="conversation-preview">${this.escapeHtml(preview)}</div>
                            ${tagsHtml}
                            <div class="conversation-meta">
                                <span class="conversation-message-count">${messageCount} message${messageCount !== 1 ? 's' : ''}</span>
                                <span class="conversation-time">${lastModified}</span>
                            </div>
                        </div>
                        <div class="conversation-actions">
                            <button class="icon-btn-small add-tag-btn" data-id="${id}" title="Add tag">
                                <span class="material-icons">label</span>
                            </button>
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
                // Don't load conversation if clicking checkbox or actions
                if (e.target.closest('.conversation-checkbox') || e.target.closest('.conversation-actions')) {
                    return;
                }

                // In bulk mode, clicking conversation toggles selection
                if (this.bulkMode) {
                    this.toggleConversationSelection(item.dataset.id);
                } else {
                    this.loadConversation(item.dataset.id);
                }
            });
        });

        // Add event listeners for checkboxes (bulk mode)
        document.querySelectorAll('.conversation-checkbox').forEach(checkbox => {
            checkbox.addEventListener('change', (e) => {
                e.stopPropagation();
                const id = checkbox.dataset.id;
                if (checkbox.checked) {
                    this.selectedConversations.add(id);
                    // Enter bulk mode if this is the first selection
                    if (!this.bulkMode) {
                        this.enterBulkMode();
                    }
                } else {
                    this.selectedConversations.delete(id);
                    // Exit bulk mode if no selections left
                    if (this.selectedConversations.size === 0) {
                        this.exitBulkMode();
                    }
                }
                this.updateBulkUI();
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

        // Tag management event listeners
        document.querySelectorAll('.add-tag-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.addTagToConversation(btn.dataset.id);
            });
        });

        document.querySelectorAll('.tag-remove').forEach(icon => {
            icon.addEventListener('click', (e) => {
                e.stopPropagation();
                const pill = icon.closest('.tag-pill');
                const tag = pill.dataset.tag;
                const convId = pill.dataset.convId;
                this.removeTagFromConversation(convId, tag);
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

        document.querySelectorAll('.copy-msg-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const index = parseInt(btn.dataset.index);
                this.copyMessage(index);
            });
        });

        document.querySelectorAll('.regenerate-msg-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const index = parseInt(btn.dataset.index);
                this.regenerateMessage(index);
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
     * Toggle audio playback with enhanced controls
     */
    toggleAudioPlayback(button) {
        const audioData = button.dataset.audio;
        const audioId = button.dataset.audioId;
        if (!audioData) return;

        // Check if this audio is currently playing
        if (this.currentlyPlayingAudio && this.currentlyPlayingAudio.audioId === audioId) {
            // Toggle pause/play
            if (this.currentlyPlayingAudio.audio.paused) {
                this.currentlyPlayingAudio.audio.play();
                button.querySelector('.material-icons').textContent = 'pause';
                button.classList.add('playing');
            } else {
                this.currentlyPlayingAudio.audio.pause();
                button.querySelector('.material-icons').textContent = 'play_arrow';
                button.classList.remove('playing');
            }
        } else {
            // Stop any currently playing audio
            if (this.currentlyPlayingAudio) {
                this.stopAudioPlayback();
            }

            // Create and play new audio
            const audio = new Audio(audioData);
            button.querySelector('.material-icons').textContent = 'pause';
            button.classList.add('playing');

            // Get playback speed
            const speedSelect = document.querySelector(`.audio-speed[data-audio-id="${audioId}"]`);
            if (speedSelect) {
                audio.playbackRate = parseFloat(speedSelect.value);
            }

            // Setup event listeners
            audio.addEventListener('ended', () => {
                button.querySelector('.material-icons').textContent = 'play_arrow';
                button.classList.remove('playing');
                this.updateAudioProgress(audioId, 0, audio.duration);
                this.currentlyPlayingAudio = null;
            });

            audio.addEventListener('error', (e) => {
                console.error('Audio playback error:', e);
                this.showNotification('Failed to play audio', 'error');
                button.querySelector('.material-icons').textContent = 'play_arrow';
                button.classList.remove('playing');
                this.currentlyPlayingAudio = null;
            });

            audio.addEventListener('loadedmetadata', () => {
                this.updateAudioProgress(audioId, 0, audio.duration);
                this.drawAudioWaveform(audioId, audioData);
            });

            audio.addEventListener('timeupdate', () => {
                this.updateAudioProgress(audioId, audio.currentTime, audio.duration);
            });

            audio.play();
            this.currentlyPlayingAudio = { audio, button, audioId };

            // Handle playback speed changes
            if (speedSelect) {
                speedSelect.addEventListener('change', () => {
                    audio.playbackRate = parseFloat(speedSelect.value);
                });
            }
        }
    }

    /**
     * Stop audio playback
     */
    stopAudioPlayback() {
        if (!this.currentlyPlayingAudio) return;

        this.currentlyPlayingAudio.audio.pause();
        this.currentlyPlayingAudio.audio.currentTime = 0;
        this.currentlyPlayingAudio.button.querySelector('.material-icons').textContent = 'play_arrow';
        this.currentlyPlayingAudio.button.classList.remove('playing');

        // Reset progress
        this.updateAudioProgress(this.currentlyPlayingAudio.audioId, 0, this.currentlyPlayingAudio.audio.duration);

        this.currentlyPlayingAudio = null;
    }

    /**
     * Update audio progress bar and time display
     */
    updateAudioProgress(audioId, currentTime, duration) {
        const progressFill = document.querySelector(`.audio-progress-fill[data-audio-id="${audioId}"]`);
        const timeDisplay = document.querySelector(`.audio-time[data-audio-id="${audioId}"]`);

        if (progressFill && !isNaN(duration) && duration > 0) {
            const percentage = (currentTime / duration) * 100;
            progressFill.style.width = `${percentage}%`;
        }

        if (timeDisplay && !isNaN(duration)) {
            const formatTime = (seconds) => {
                const mins = Math.floor(seconds / 60);
                const secs = Math.floor(seconds % 60);
                return `${mins}:${secs.toString().padStart(2, '0')}`;
            };

            timeDisplay.textContent = `${formatTime(currentTime)} / ${formatTime(duration)}`;
        }
    }

    /**
     * Draw audio waveform visualization
     */
    async drawAudioWaveform(audioId, audioData) {
        const canvas = document.querySelector(`.audio-waveform[data-audio-id="${audioId}"]`);
        if (!canvas) return;

        try {
            // Create audio context
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();

            // Fetch audio data
            const response = await fetch(audioData);
            const arrayBuffer = await response.arrayBuffer();
            const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

            // Get audio data
            const rawData = audioBuffer.getChannelData(0);
            const samples = 100; // Number of bars in waveform
            const blockSize = Math.floor(rawData.length / samples);
            const filteredData = [];

            for (let i = 0; i < samples; i++) {
                let blockStart = blockSize * i;
                let sum = 0;
                for (let j = 0; j < blockSize; j++) {
                    sum += Math.abs(rawData[blockStart + j]);
                }
                filteredData.push(sum / blockSize);
            }

            // Normalize data
            const maxValue = Math.max(...filteredData);
            const normalizedData = filteredData.map(n => n / maxValue);

            // Draw waveform
            const ctx = canvas.getContext('2d');
            const width = canvas.width;
            const height = canvas.height;
            const barWidth = width / samples;

            ctx.clearRect(0, 0, width, height);

            // Draw bars
            for (let i = 0; i < normalizedData.length; i++) {
                const barHeight = normalizedData[i] * height * 0.8;
                const x = i * barWidth;
                const y = (height - barHeight) / 2;

                // Gradient
                const gradient = ctx.createLinearGradient(0, 0, 0, height);
                gradient.addColorStop(0, '#00D2DD');
                gradient.addColorStop(1, '#3CD7E0');

                ctx.fillStyle = gradient;
                ctx.fillRect(x, y, barWidth - 1, barHeight);
            }
        } catch (error) {
            console.error('Failed to draw waveform:', error);
            // Draw placeholder waveform
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = '#E0E0E0';
            ctx.fillRect(0, canvas.height / 2 - 2, canvas.width, 4);
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
                    <button class="action-btn copy-msg-btn" data-index="${index}" title="Copy message">
                        <span class="material-icons">content_copy</span>
                    </button>
                    <button class="action-btn edit-msg-btn" data-index="${index}" title="Edit">
                        <span class="material-icons">edit</span>
                    </button>
                    ${isUser ? `
                        <button class="action-btn replay-msg-btn" data-index="${index}" title="Replay from here">
                            <span class="material-icons">replay</span>
                        </button>
                    ` : `
                        <button class="action-btn regenerate-msg-btn" data-index="${index}" title="Regenerate response">
                            <span class="material-icons">refresh</span>
                        </button>
                    `}
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

                        const audioId = `audio_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                        html += `<div class="message-audio-container" data-audio-id="${audioId}">
                            <div class="audio-player">
                                <button class="audio-play-btn" data-audio="${this.escapeHtml(data)}" data-audio-id="${audioId}" title="Play">
                                    <span class="material-icons">play_arrow</span>
                                </button>
                                <div class="audio-player-controls">
                                    <div class="audio-waveform-container">
                                        <canvas class="audio-waveform" data-audio-id="${audioId}" width="300" height="60"></canvas>
                                        <div class="audio-progress-bar">
                                            <div class="audio-progress-fill" data-audio-id="${audioId}"></div>
                                        </div>
                                    </div>
                                    <div class="audio-meta">
                                        <span class="audio-time" data-audio-id="${audioId}">0:00 / 0:00</span>
                                        <div class="audio-secondary-controls">
                                            <select class="audio-speed" data-audio-id="${audioId}" title="Playback speed">
                                                <option value="0.5">0.5x</option>
                                                <option value="0.75">0.75x</option>
                                                <option value="1" selected>1x</option>
                                                <option value="1.25">1.25x</option>
                                                <option value="1.5">1.5x</option>
                                                <option value="2">2x</option>
                                            </select>
                                            <a href="${this.escapeHtml(data)}" download="${this.escapeHtml(filename)}" class="audio-download-btn" title="Download">
                                                <span class="material-icons">download</span>
                                            </a>
                                        </div>
                                    </div>
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
     * Copy message content to clipboard
     */
    async copyMessage(index) {
        const message = this.messages[index];
        if (!message) return;

        let textToCopy = '';

        // Extract text from message content
        if (typeof message.content === 'string') {
            textToCopy = message.content;
        } else if (Array.isArray(message.content)) {
            // For multimodal content, extract text parts
            const textParts = message.content
                .filter(item => item.type === 'text')
                .map(item => item.text);
            textToCopy = textParts.join('\n\n');
        }

        try {
            await navigator.clipboard.writeText(textToCopy);
            this.showNotification('Message copied to clipboard', 'success');
        } catch (error) {
            console.error('Failed to copy message:', error);
            this.showNotification('Failed to copy message', 'error');
        }
    }

    /**
     * Regenerate assistant response
     */
    async regenerateMessage(index) {
        const message = this.messages[index];
        if (!message || message.role !== 'assistant') return;

        // Remove this assistant message
        this.messages.splice(index, 1);
        this.renderMessages();
        this.saveConversations();

        // Regenerate response
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
                // Always use local dataURL (available immediately)
                let dataURL = file.dataURL;
                let gdriveUrl = file.gdriveUrl || null; // Use gdrive URL if upload completed

                // If upload completed, download from Google Drive for better long-term storage
                if (gdriveUrl) {
                    try {
                        dataURL = await this.storageManager.downloadArtifact(gdriveUrl);
                    } catch (error) {
                        console.warn('Failed to download from Google Drive, using local data:', error);
                        // Fall back to local dataURL
                        gdriveUrl = null;
                    }
                }

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

            // Note: Google Drive artifacts are already cached as base64 in this.messages
            // from cacheGoogleDriveArtifacts(), so no need to resolve them here

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

            const duration = Date.now() - this.recordingStartTime;
            const filename = `recording_${Date.now()}.${this.getFileExtension(this.mediaRecorder.mimeType)}`;

            // Show immediately with local data URL (non-blocking)
            const dataURL = await this.blobToDataURL(audioBlob);

            const fileObj = {
                fileName: filename,
                fileType: this.mediaRecorder.mimeType,
                fileSize: audioBlob.size,
                dataURL: dataURL,
                isArtifact: false,
                uploading: false
            };

            this.selectedFiles.push(fileObj);
            this.renderFilePreview(); // Show immediately!

            // Upload to Google Drive in background if online
            const syncStatus = this.storageManager.getSyncStatus();
            if (syncStatus.mode === 'online') {
                fileObj.uploading = true;
                this.renderFilePreview(); // Update to show uploading state

                // Check if we already uploaded chunks during recording
                if (this.currentRecordingGDriveId && this.uploadedChunks.length > 0) {
                    console.log('Recording was streamed to Google Drive during recording');

                    // Upload any remaining chunks
                    const remainingChunks = this.audioChunks.slice(this.uploadedChunks.length);
                    if (remainingChunks.length > 0) {
                        console.log(`Uploading ${remainingChunks.length} remaining chunks...`);
                        await this.uploadRecordingChunks();
                    }

                    // Use the Google Drive file we've been building
                    const gdriveUrl = `gdrive://${this.currentRecordingGDriveId}`;
                    fileObj.gdriveUrl = gdriveUrl;
                    fileObj.isArtifact = true;
                    fileObj.uploading = false;
                    fileObj.source = 'gdrive';

                    console.log('Recording complete, using streamed Google Drive file:', gdriveUrl);
                } else {
                    // No streaming happened, upload complete file now
                    console.log('Uploading complete recording to Google Drive...');
                    this.uploadToGoogleDriveInBackground(audioBlob, fileObj);
                }
            } else {
                // Mark as temporary if offline
                fileObj.temporary = true;
                this.showNotification('Recording added (will not be saved - connect to Google Drive to save)', 'warning');
            }

            // Clean up streaming state
            this.uploadedChunks = [];
            this.currentRecordingGDriveId = null;

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

                    // Show immediately with local data URL (non-blocking)
                    const dataURL = await this.fileToDataURL(file);

                    const fileObj = {
                        fileName: file.name,
                        fileType: file.type,
                        fileSize: file.size,
                        dataURL: dataURL,
                        isArtifact: false,
                        uploading: false
                    };

                    this.selectedFiles.push(fileObj);
                    this.renderFilePreview(); // Show immediately!

                    // Upload to Google Drive in background if online
                    const syncStatus = this.storageManager.getSyncStatus();
                    if (syncStatus.mode === 'online' && (isAudio || isImage || isPDF || file.size > this.FILE_SIZE_THRESHOLD)) {
                        fileObj.uploading = true;
                        this.renderFilePreview(); // Update to show uploading state

                        // Non-blocking upload
                        this.uploadToGoogleDriveInBackground(file, fileObj);
                    } else if (isAudio || isImage) {
                        // Mark as temporary if offline
                        fileObj.temporary = true;
                        const fileTypeLabel = isAudio ? 'Audio' : 'Image';
                        this.showNotification(`${fileTypeLabel} added (will not be saved - connect to Google Drive to save)`, 'warning');
                    }

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
            } else if (file.fileType.startsWith('audio/')) {
                // Show audio icon
                thumbnail = `<div class="file-preview-thumbnail-placeholder" style="background-color: var(--turquoise);"><span class="material-icons" style="color: white;">audiotrack</span></div>`;
            }

            // Add trim button for audio files
            let actions = '';
            if (file.fileType.startsWith('audio/') && !file.uploading) {
                actions = `
                    <div class="file-preview-actions">
                        <button class="trim-file-btn" data-index="${index}" title="Trim audio">
                            <span class="material-icons">content_cut</span>
                            Trim
                        </button>
                    </div>
                `;
            }

            html += `
                <div class="file-preview-item" data-index="${index}">
                    ${thumbnail}
                    <div class="file-info">
                        <span class="file-name">${this.escapeHtml(file.fileName)}</span>
                        <span class="file-size">${sizeStr}</span>
                        ${badge}
                        ${actions}
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

        // Add trim listeners
        document.querySelectorAll('.trim-file-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const index = parseInt(btn.dataset.index);
                this.openTrimModal(index);
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

    /**
     * Show keyboard shortcuts help modal
     */
    showKeyboardShortcutsHelp() {
        if (!this.keyboardShortcutsModal) {
            console.warn('Keyboard shortcuts modal not found');
            return;
        }

        this.keyboardShortcutsModal.classList.remove('hidden');
    }

    /**
     * Initialize dark mode from storage or system preference
     */
    initializeDarkMode() {
        const savedMode = localStorage.getItem('darkMode');
        const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

        if (savedMode === 'dark' || (savedMode === null && systemPrefersDark)) {
            document.body.classList.add('dark-mode');
            this.updateDarkModeIcon(true);
        }

        // Listen for system preference changes
        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
            if (localStorage.getItem('darkMode') === null) {
                if (e.matches) {
                    document.body.classList.add('dark-mode');
                    this.updateDarkModeIcon(true);
                } else {
                    document.body.classList.remove('dark-mode');
                    this.updateDarkModeIcon(false);
                }
            }
        });
    }

    /**
     * Toggle dark mode
     */
    toggleDarkMode() {
        const isDark = document.body.classList.toggle('dark-mode');
        localStorage.setItem('darkMode', isDark ? 'dark' : 'light');
        this.updateDarkModeIcon(isDark);
        this.showNotification(`${isDark ? 'Dark' : 'Light'} mode enabled`, 'success');
    }

    /**
     * Update dark mode toggle icon
     */
    updateDarkModeIcon(isDark) {
        if (this.darkModeToggle) {
            const icon = this.darkModeToggle.querySelector('.material-icons');
            if (icon) {
                icon.textContent = isDark ? 'light_mode' : 'dark_mode';
            }
        }
    }

    /**
     * Apply markdown formatting to selected text or at cursor
     */
    applyMarkdownFormat(format) {
        const textarea = this.userInput;
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const selectedText = textarea.value.substring(start, end);
        const beforeText = textarea.value.substring(0, start);
        const afterText = textarea.value.substring(end);

        let newText = '';
        let newCursorPos = start;

        switch (format) {
            case 'bold':
                newText = `${beforeText}**${selectedText || 'bold text'}**${afterText}`;
                newCursorPos = selectedText ? end + 4 : start + 2;
                break;

            case 'italic':
                newText = `${beforeText}*${selectedText || 'italic text'}*${afterText}`;
                newCursorPos = selectedText ? end + 2 : start + 1;
                break;

            case 'code':
                newText = `${beforeText}\`${selectedText || 'code'}\`${afterText}`;
                newCursorPos = selectedText ? end + 2 : start + 1;
                break;

            case 'heading':
                // Add heading at start of line
                const lineStart = beforeText.lastIndexOf('\n') + 1;
                const lineText = textarea.value.substring(lineStart);
                newText = beforeText.substring(0, lineStart) + `## ${lineText}`;
                newCursorPos = lineStart + 3;
                break;

            case 'list':
                // Add bullet point at start of line
                const listLineStart = beforeText.lastIndexOf('\n') + 1;
                const listLineText = textarea.value.substring(listLineStart);
                newText = beforeText.substring(0, listLineStart) + `- ${listLineText}`;
                newCursorPos = listLineStart + 2;
                break;

            case 'numbered':
                // Add numbered list at start of line
                const numLineStart = beforeText.lastIndexOf('\n') + 1;
                const numLineText = textarea.value.substring(numLineStart);
                newText = beforeText.substring(0, numLineStart) + `1. ${numLineText}`;
                newCursorPos = numLineStart + 3;
                break;

            case 'quote':
                // Add quote at start of line
                const quoteLineStart = beforeText.lastIndexOf('\n') + 1;
                const quoteLineText = textarea.value.substring(quoteLineStart);
                newText = beforeText.substring(0, quoteLineStart) + `> ${quoteLineText}`;
                newCursorPos = quoteLineStart + 2;
                break;

            case 'link':
                newText = `${beforeText}[${selectedText || 'link text'}](url)${afterText}`;
                newCursorPos = selectedText ? start + selectedText.length + 3 : start + 1;
                break;

            case 'codeblock':
                newText = `${beforeText}\`\`\`\n${selectedText || 'code'}\n\`\`\`${afterText}`;
                newCursorPos = selectedText ? end + 4 : start + 4;
                break;

            default:
                return;
        }

        textarea.value = newText;
        textarea.setSelectionRange(newCursorPos, newCursorPos);

        // Trigger input event to auto-resize textarea
        textarea.dispatchEvent(new Event('input'));
    }

    /**
     * Handle slash command input detection
     */
    handleSlashCommandInput() {
        const input = this.userInput.value;
        const cursorPos = this.userInput.selectionStart;

        // Find the start of the current line
        const textBeforeCursor = input.substring(0, cursorPos);
        const lastNewline = textBeforeCursor.lastIndexOf('\n');
        const currentLineStart = lastNewline + 1;
        const currentLine = input.substring(currentLineStart, cursorPos);

        // Check if line starts with "/" and has no spaces before it
        if (currentLine.startsWith('/') && !currentLine.substring(0, currentLine.indexOf('/')).includes(' ')) {
            const query = currentLine.substring(1).toLowerCase();
            const commands = this.getSlashCommands();

            // Filter commands based on query
            this.filteredCommands = commands.filter(cmd =>
                cmd.name.toLowerCase().includes('/' + query)
            );

            if (this.filteredCommands.length > 0) {
                this.selectedCommandIndex = 0;
                this.showSlashCommands();
                this.renderSlashCommands();
            } else {
                this.hideSlashCommands();
            }
        } else {
            this.hideSlashCommands();
        }
    }

    /**
     * Show slash commands dropdown
     */
    showSlashCommands() {
        this.slashCommandsVisible = true;
        this.slashCommandsDropdown.classList.remove('hidden');
    }

    /**
     * Hide slash commands dropdown
     */
    hideSlashCommands() {
        this.slashCommandsVisible = false;
        this.slashCommandsDropdown.classList.add('hidden');
        this.selectedCommandIndex = 0;
    }

    /**
     * Render slash commands in dropdown
     */
    renderSlashCommands() {
        if (this.filteredCommands.length === 0) {
            this.slashCommandsList.innerHTML = '<div class="slash-commands-empty">No commands found</div>';
            return;
        }

        let html = '';
        this.filteredCommands.forEach((cmd, index) => {
            const isSelected = index === this.selectedCommandIndex;
            html += `
                <div class="slash-command-item ${isSelected ? 'selected' : ''}" data-index="${index}">
                    <div class="slash-command-icon">
                        <span class="material-icons">${cmd.icon}</span>
                    </div>
                    <div class="slash-command-info">
                        <div class="slash-command-title">
                            <span class="slash-command-name">${cmd.name}</span>
                        </div>
                        <div class="slash-command-desc">${this.escapeHtml(cmd.description)}</div>
                    </div>
                </div>
            `;
        });

        this.slashCommandsList.innerHTML = html;

        // Add click listeners
        document.querySelectorAll('.slash-command-item').forEach(item => {
            item.addEventListener('click', () => {
                const index = parseInt(item.dataset.index);
                this.executeSlashCommand(this.filteredCommands[index]);
            });
        });
    }

    /**
     * Navigate slash commands with arrow keys
     */
    navigateSlashCommands(direction) {
        if (this.filteredCommands.length === 0) return;

        if (direction === 'down') {
            this.selectedCommandIndex = (this.selectedCommandIndex + 1) % this.filteredCommands.length;
        } else if (direction === 'up') {
            this.selectedCommandIndex = (this.selectedCommandIndex - 1 + this.filteredCommands.length) % this.filteredCommands.length;
        }

        this.renderSlashCommands();

        // Scroll selected item into view
        const selectedItem = this.slashCommandsList.querySelector('.slash-command-item.selected');
        if (selectedItem) {
            selectedItem.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
    }

    /**
     * Execute slash command
     */
    executeSlashCommand(command) {
        const input = this.userInput.value;
        const cursorPos = this.userInput.selectionStart;

        // Find the slash command in the text
        const textBeforeCursor = input.substring(0, cursorPos);
        const lastNewline = textBeforeCursor.lastIndexOf('\n');
        const currentLineStart = lastNewline + 1;
        const slashPos = input.indexOf('/', currentLineStart);

        // Find end of slash command
        let slashEnd = slashPos;
        while (slashEnd < input.length && input[slashEnd] !== ' ' && input[slashEnd] !== '\n') {
            slashEnd++;
        }

        // Replace slash command with template
        const before = input.substring(0, slashPos);
        const after = input.substring(slashEnd);
        const newText = before + command.template + after;

        this.userInput.value = newText;

        // Position cursor at end of template or at placeholder
        const newCursorPos = before.length + command.template.length;
        this.userInput.setSelectionRange(newCursorPos, newCursorPos);

        // Hide dropdown
        this.hideSlashCommands();

        // Focus input
        this.userInput.focus();

        // Show notification
        this.showNotification(`Inserted ${command.name}`, 'success');
    }

    /**
     * Initialize speech recognition
     */
    initializeSpeechRecognition() {
        // Check if browser supports speech recognition
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

        if (!SpeechRecognition) {
            console.warn('Speech recognition not supported in this browser');
            this.voiceInputBtn.style.display = 'none'; // Hide button if not supported
            return;
        }

        this.recognition = new SpeechRecognition();
        this.recognition.continuous = true; // Keep listening until stopped
        this.recognition.interimResults = true; // Show interim results
        this.recognition.lang = 'en-US';

        // Handle recognition results
        this.recognition.onresult = (event) => {
            let interimTranscript = '';
            let finalTranscript = '';

            for (let i = event.resultIndex; i < event.results.length; i++) {
                const transcript = event.results[i][0].transcript;
                if (event.results[i].isFinal) {
                    finalTranscript += transcript + ' ';
                } else {
                    interimTranscript += transcript;
                }
            }

            // Insert recognized text into input
            if (finalTranscript) {
                const currentValue = this.userInput.value;
                const cursorPos = this.userInput.selectionStart;
                const before = currentValue.substring(0, cursorPos);
                const after = currentValue.substring(cursorPos);

                this.userInput.value = before + finalTranscript + after;

                // Move cursor to end of inserted text
                const newCursorPos = before.length + finalTranscript.length;
                this.userInput.setSelectionRange(newCursorPos, newCursorPos);

                // Trigger input event for auto-resize
                this.userInput.dispatchEvent(new Event('input'));
            }
        };

        // Handle recognition errors
        this.recognition.onerror = (event) => {
            console.error('Speech recognition error:', event.error);

            let errorMessage = 'Voice input error';
            switch (event.error) {
                case 'no-speech':
                    errorMessage = 'No speech detected. Please try again.';
                    break;
                case 'audio-capture':
                    errorMessage = 'No microphone found. Please check your microphone.';
                    break;
                case 'not-allowed':
                    errorMessage = 'Microphone permission denied. Please allow microphone access.';
                    break;
                default:
                    errorMessage = `Voice input error: ${event.error}`;
            }

            this.showNotification(errorMessage, 'error');
            this.stopVoiceInput();
        };

        // Handle recognition end
        this.recognition.onend = () => {
            if (this.isListening) {
                // If we're still supposed to be listening, restart
                // (this can happen if recognition stops due to silence)
                try {
                    this.recognition.start();
                } catch (error) {
                    console.error('Failed to restart recognition:', error);
                    this.stopVoiceInput();
                }
            }
        };

        console.log('Speech recognition initialized');
    }

    /**
     * Toggle voice input
     */
    toggleVoiceInput() {
        if (this.isListening) {
            this.stopVoiceInput();
        } else {
            this.startVoiceInput();
        }
    }

    /**
     * Start voice input
     */
    startVoiceInput() {
        if (!this.recognition) {
            this.showNotification('Speech recognition not supported in this browser', 'error');
            return;
        }

        try {
            this.recognition.start();
            this.isListening = true;
            this.voiceInputBtn.classList.add('listening');
            this.voiceInputBtn.title = 'Stop listening';
            this.showNotification('Listening... Speak now', 'info');
            console.log('Voice input started');
        } catch (error) {
            console.error('Failed to start voice input:', error);
            this.showNotification('Failed to start voice input', 'error');
        }
    }

    /**
     * Stop voice input
     */
    stopVoiceInput() {
        if (!this.recognition) return;

        try {
            this.recognition.stop();
            this.isListening = false;
            this.voiceInputBtn.classList.remove('listening');
            this.voiceInputBtn.title = 'Voice Input (Speech-to-Text)';
            console.log('Voice input stopped');
        } catch (error) {
            console.error('Failed to stop voice input:', error);
        }
    }

    /**
     * Load templates from localStorage
     */
    loadTemplates() {
        try {
            const saved = localStorage.getItem('prompt_templates');
            if (saved) {
                this.templates = JSON.parse(saved);
            } else {
                // Initialize with some default templates
                this.templates = [
                    {
                        id: 'template_1',
                        name: 'Bug Report',
                        content: '**Bug Description:**\n\n**Steps to Reproduce:**\n1. \n2. \n\n**Expected Behavior:**\n\n**Actual Behavior:**\n'
                    },
                    {
                        id: 'template_2',
                        name: 'Code Review Request',
                        content: 'Please review this code and provide feedback on:\n- Code quality and best practices\n- Potential bugs or edge cases\n- Performance improvements\n- Security concerns\n\n```\n\n```'
                    },
                    {
                        id: 'template_3',
                        name: 'Explain Concept',
                        content: 'Please explain the following concept in simple terms:\n\n**Concept:** \n\n**Include:**\n- Definition\n- Real-world examples\n- Common use cases\n'
                    }
                ];
                this.saveTemplates();
            }
            this.renderTemplates();
        } catch (error) {
            console.error('Failed to load templates:', error);
            this.templates = [];
        }
    }

    /**
     * Save templates to localStorage
     */
    saveTemplates() {
        try {
            localStorage.setItem('prompt_templates', JSON.stringify(this.templates));
        } catch (error) {
            console.error('Failed to save templates:', error);
            this.showNotification('Failed to save templates', 'error');
        }
    }

    /**
     * Render templates in dropdown
     */
    renderTemplates() {
        if (this.templates.length === 0) {
            this.templatesList.innerHTML = '<div class="empty-state">No templates yet</div>';
            return;
        }

        let html = '';
        this.templates.forEach((template, index) => {
            html += `
                <div class="dropdown-item template-item" data-index="${index}">
                    <span class="material-icons">description</span>
                    <span>${this.escapeHtml(template.name)}</span>
                </div>
            `;
        });

        this.templatesList.innerHTML = html;

        // Add click listeners
        document.querySelectorAll('.template-item').forEach(item => {
            item.addEventListener('click', () => {
                const index = parseInt(item.dataset.index);
                this.insertTemplate(this.templates[index]);
                this.templatesDropdown.classList.add('hidden');
            });
        });
    }

    /**
     * Insert template into input
     */
    insertTemplate(template) {
        const currentValue = this.userInput.value;
        const cursorPos = this.userInput.selectionStart;
        const before = currentValue.substring(0, cursorPos);
        const after = currentValue.substring(cursorPos);

        this.userInput.value = before + template.content + after;

        // Move cursor to end of inserted text
        const newCursorPos = before.length + template.content.length;
        this.userInput.setSelectionRange(newCursorPos, newCursorPos);

        // Focus input and trigger resize
        this.userInput.focus();
        this.userInput.dispatchEvent(new Event('input'));

        this.showNotification(`Inserted template: ${template.name}`, 'success');
    }

    /**
     * Save current input as template
     */
    saveCurrentAsTemplate() {
        const content = this.userInput.value.trim();

        if (!content) {
            this.showNotification('Input is empty. Nothing to save.', 'warning');
            return;
        }

        const name = prompt('Enter a name for this template:');
        if (!name || !name.trim()) {
            return;
        }

        const template = {
            id: `template_${Date.now()}`,
            name: name.trim(),
            content: content
        };

        this.templates.push(template);
        this.saveTemplates();
        this.renderTemplates();

        this.showNotification(`Template "${name}" saved`, 'success');
    }

    /**
     * Manage templates (show modal with edit/delete options)
     */
    manageTemplates() {
        if (this.templates.length === 0) {
            this.showNotification('No templates to manage', 'info');
            return;
        }

        // Build template list
        let templatesList = this.templates.map((t, i) => `${i + 1}. ${t.name}`).join('\n');
        const action = prompt(`Templates:\n\n${templatesList}\n\nEnter template number to delete, or "cancel" to close:`);

        if (!action || action.toLowerCase() === 'cancel') {
            return;
        }

        const index = parseInt(action) - 1;
        if (isNaN(index) || index < 0 || index >= this.templates.length) {
            this.showNotification('Invalid template number', 'error');
            return;
        }

        const template = this.templates[index];
        const confirmDelete = confirm(`Delete template "${template.name}"?`);

        if (confirmDelete) {
            this.templates.splice(index, 1);
            this.saveTemplates();
            this.renderTemplates();
            this.showNotification(`Template "${template.name}" deleted`, 'success');
        }
    }

    /**
     * Update character and token counter
     */
    updateCharTokenCounter() {
        const text = this.userInput.value;
        const charCount = text.length;

        // Estimate tokens (rough approximation: 1 token ≈ 4 characters)
        // This is a simplified estimate - actual tokenization varies by model
        const estimatedTokens = Math.ceil(charCount / 4);

        this.charCountValue.textContent = charCount.toLocaleString();
        this.tokenCountValue.textContent = `~${estimatedTokens.toLocaleString()}`;
    }

    /**
     * Load folders from localStorage
     */
    loadFolders() {
        try {
            const saved = localStorage.getItem('conversation_folders');
            if (saved) {
                this.folders = JSON.parse(saved);
            } else {
                this.folders = [];
            }
            this.renderFolders();
        } catch (error) {
            console.error('Failed to load folders:', error);
            this.folders = [];
        }
    }

    /**
     * Save folders to localStorage
     */
    saveFolders() {
        try {
            localStorage.setItem('conversation_folders', JSON.stringify(this.folders));
        } catch (error) {
            console.error('Failed to save folders:', error);
            this.showNotification('Failed to save folders', 'error');
        }
    }

    /**
     * Render folders list
     */
    renderFolders() {
        if (this.folders.length === 0) {
            this.foldersList.innerHTML = '';
            this.updateFolderCounts();
            return;
        }

        let html = '';
        this.folders.forEach(folder => {
            const count = this.getConversationCountForFolder(folder.id);
            const isActive = this.selectedFolderId === folder.id;

            html += `
                <div class="folder-item ${isActive ? 'active' : ''}" data-folder="${folder.id}" draggable="false">
                    <span class="material-icons folder-icon">${folder.icon || 'folder'}</span>
                    <span class="folder-name">${this.escapeHtml(folder.name)}</span>
                    <span class="folder-count">${count}</span>
                    <div class="folder-actions">
                        <button class="folder-action-btn rename-folder-btn" data-folder-id="${folder.id}" title="Rename">
                            <span class="material-icons">edit</span>
                        </button>
                        <button class="folder-action-btn delete-folder-btn" data-folder-id="${folder.id}" title="Delete">
                            <span class="material-icons">delete</span>
                        </button>
                    </div>
                </div>
            `;
        });

        this.foldersList.innerHTML = html;

        // Add event listeners for folder actions
        document.querySelectorAll('.rename-folder-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.renameFolder(btn.dataset.folderId);
            });
        });

        document.querySelectorAll('.delete-folder-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.deleteFolder(btn.dataset.folderId);
            });
        });

        // Enable drag-and-drop for folders
        this.setupFolderDragDrop();

        // Update folder counts
        this.updateFolderCounts();
    }

    /**
     * Create new folder
     */
    createFolder() {
        const name = prompt('Enter folder name:');
        if (!name || !name.trim()) return;

        const folder = {
            id: `folder_${Date.now()}`,
            name: name.trim(),
            icon: 'folder',
            createdAt: Date.now()
        };

        this.folders.push(folder);
        this.saveFolders();
        this.renderFolders();
        this.showNotification(`Folder "${name}" created`, 'success');
    }

    /**
     * Rename folder
     */
    renameFolder(folderId) {
        const folder = this.folders.find(f => f.id === folderId);
        if (!folder) return;

        const newName = prompt('Enter new folder name:', folder.name);
        if (!newName || !newName.trim()) return;

        folder.name = newName.trim();
        this.saveFolders();
        this.renderFolders();
        this.showNotification(`Folder renamed to "${newName}"`, 'success');
    }

    /**
     * Delete folder
     */
    deleteFolder(folderId) {
        const folder = this.folders.find(f => f.id === folderId);
        if (!folder) return;

        // Check if folder has conversations
        const conversationsInFolder = Object.values(this.conversations).filter(
            conv => conv.folderId === folderId
        );

        let confirmMsg = `Delete folder "${folder.name}"?`;
        if (conversationsInFolder.length > 0) {
            confirmMsg += `\n\nThis folder contains ${conversationsInFolder.length} conversation(s). They will be moved to "All Conversations".`;
        }

        if (!confirm(confirmMsg)) return;

        // Move conversations out of folder
        conversationsInFolder.forEach(conv => {
            delete conv.folderId;
        });

        // Remove folder
        this.folders = this.folders.filter(f => f.id !== folderId);
        this.saveFolders();
        this.saveConversations();

        // If this folder was selected, switch to "All"
        if (this.selectedFolderId === folderId) {
            this.selectFolder('all');
        }

        this.renderFolders();
        this.renderConversationsList();
        this.showNotification(`Folder "${folder.name}" deleted`, 'success');
    }

    /**
     * Select folder (filter conversations)
     */
    selectFolder(folderId) {
        this.selectedFolderId = folderId;

        // Update active state
        document.querySelectorAll('.folder-item').forEach(item => {
            item.classList.toggle('active', item.dataset.folder === folderId);
        });

        // Re-render conversations list with filter
        this.renderConversationsList();
    }

    /**
     * Get conversation count for a folder
     */
    getConversationCountForFolder(folderId) {
        if (folderId === 'all') {
            return Object.keys(this.conversations).length;
        }

        return Object.values(this.conversations).filter(
            conv => conv.folderId === folderId
        ).length;
    }

    /**
     * Update folder counts
     */
    updateFolderCounts() {
        // Update "All Conversations" count
        if (this.allFolderCount) {
            this.allFolderCount.textContent = this.getConversationCountForFolder('all');
        }

        // Update individual folder counts
        this.folders.forEach(folder => {
            const count = this.getConversationCountForFolder(folder.id);
            const folderElement = document.querySelector(`.folder-item[data-folder="${folder.id}"] .folder-count`);
            if (folderElement) {
                folderElement.textContent = count;
            }
        });
    }

    /**
     * Setup drag-and-drop for folders
     */
    setupFolderDragDrop() {
        // Make conversations draggable
        document.querySelectorAll('.conversation-item').forEach(item => {
            item.draggable = true;

            item.addEventListener('dragstart', (e) => {
                e.dataTransfer.setData('conversationId', item.dataset.id);
                item.classList.add('dragging');
            });

            item.addEventListener('dragend', (e) => {
                item.classList.remove('dragging');
            });
        });

        // Make folders drop targets
        document.querySelectorAll('.folder-item').forEach(folder => {
            folder.addEventListener('dragover', (e) => {
                e.preventDefault();
                folder.classList.add('drag-over');
            });

            folder.addEventListener('dragleave', (e) => {
                folder.classList.remove('drag-over');
            });

            folder.addEventListener('drop', (e) => {
                e.preventDefault();
                folder.classList.remove('drag-over');

                const conversationId = e.dataTransfer.getData('conversationId');
                const folderId = folder.dataset.folder;

                if (conversationId && folderId) {
                    this.moveConversationToFolder(conversationId, folderId);
                }
            });
        });
    }

    /**
     * Move conversation to folder
     */
    moveConversationToFolder(conversationId, folderId) {
        const conversation = this.conversations[conversationId];
        if (!conversation) return;

        const oldFolderId = conversation.folderId || 'all';

        // Set new folder (or remove folder if moving to "All")
        if (folderId === 'all') {
            delete conversation.folderId;
        } else {
            conversation.folderId = folderId;
        }

        conversation.lastModified = Date.now();
        this.saveConversations();
        this.renderFolders();
        this.renderConversationsList();

        const folderName = folderId === 'all' ? 'All Conversations' :
            this.folders.find(f => f.id === folderId)?.name || 'Unknown';

        this.showNotification(`Conversation moved to "${folderName}"`, 'success');
    }

    /**
     * Update available tags from all conversations
     */
    updateAvailableTags() {
        const tagsSet = new Set();

        Object.values(this.conversations).forEach(conv => {
            if (conv.tags && Array.isArray(conv.tags)) {
                conv.tags.forEach(tag => tagsSet.add(tag));
            }
        });

        this.availableTags = Array.from(tagsSet).sort();
    }

    /**
     * Render tags filter list
     */
    renderTagsFilter() {
        if (this.availableTags.length === 0) {
            this.tagsFilterList.innerHTML = '<div class="empty-state" style="font-size: 0.75rem; padding: var(--spacing-sm) 0;">No tags yet</div>';
            return;
        }

        let html = '';
        this.availableTags.forEach(tag => {
            const count = this.getConversationCountForTag(tag);
            const isActive = this.selectedTagFilter === tag;

            html += `
                <div class="tag-filter-pill ${isActive ? 'active' : ''}" data-tag="${this.escapeHtml(tag)}">
                    ${this.escapeHtml(tag)}
                    <span class="tag-count">(${count})</span>
                </div>
            `;
        });

        this.tagsFilterList.innerHTML = html;

        // Add click listeners
        document.querySelectorAll('.tag-filter-pill').forEach(pill => {
            pill.addEventListener('click', () => {
                const tag = pill.dataset.tag;
                this.selectTagFilter(tag);
            });
        });
    }

    /**
     * Select tag filter
     */
    selectTagFilter(tag) {
        this.selectedTagFilter = tag;
        this.renderTagsFilter();
        this.renderConversationsList();

        // Show clear button
        this.clearTagFilterBtn.classList.remove('hidden');
    }

    /**
     * Clear tag filter
     */
    clearTagFilter() {
        this.selectedTagFilter = null;
        this.renderTagsFilter();
        this.renderConversationsList();

        // Hide clear button
        this.clearTagFilterBtn.classList.add('hidden');
    }

    /**
     * Get conversation count for a tag
     */
    getConversationCountForTag(tag) {
        return Object.values(this.conversations).filter(
            conv => conv.tags && conv.tags.includes(tag)
        ).length;
    }

    /**
     * Add tag to conversation
     */
    addTagToConversation(conversationId) {
        const conversation = this.conversations[conversationId];
        if (!conversation) return;

        const tag = prompt('Enter tag name:');
        if (!tag || !tag.trim()) return;

        const normalizedTag = tag.trim().toLowerCase();

        // Initialize tags array if needed
        if (!conversation.tags) {
            conversation.tags = [];
        }

        // Check if tag already exists
        if (conversation.tags.includes(normalizedTag)) {
            this.showNotification('Tag already exists on this conversation', 'warning');
            return;
        }

        conversation.tags.push(normalizedTag);
        conversation.lastModified = Date.now();

        this.saveConversations();
        this.updateAvailableTags();
        this.renderTagsFilter();
        this.renderConversationsList();

        this.showNotification(`Tag "${normalizedTag}" added`, 'success');
    }

    /**
     * Remove tag from conversation
     */
    removeTagFromConversation(conversationId, tag) {
        const conversation = this.conversations[conversationId];
        if (!conversation || !conversation.tags) return;

        conversation.tags = conversation.tags.filter(t => t !== tag);
        conversation.lastModified = Date.now();

        this.saveConversations();
        this.updateAvailableTags();
        this.renderTagsFilter();
        this.renderConversationsList();

        this.showNotification(`Tag "${tag}" removed`, 'success');
    }

    /**
     * Toggle search filters panel
     */
    toggleSearchFilters() {
        if (!this.searchFiltersPanel) return;

        this.searchFiltersPanel.classList.toggle('hidden');

        // Update button state
        if (this.searchFiltersBtn) {
            this.searchFiltersBtn.classList.toggle('active');
        }
    }

    /**
     * Apply search filter
     */
    applyFilter(filterType, filterValue) {
        // Update filter state
        this.searchFilters[filterType] = filterValue;

        // Update button states
        document.querySelectorAll(`.filter-btn[data-filter="${filterType}"]`).forEach(btn => {
            btn.classList.toggle('active', btn.dataset.value === filterValue);
        });

        // Re-render conversations list with new filter
        this.renderConversationsList();

        // Show notification
        const filterLabels = {
            date: {
                all: 'All dates',
                today: 'Today',
                week: 'This week',
                month: 'This month'
            },
            messages: {
                all: 'All conversations',
                short: '1-5 messages',
                medium: '6-20 messages',
                long: '20+ messages'
            }
        };

        const label = filterLabels[filterType]?.[filterValue] || filterValue;
        this.showNotification(`Filter applied: ${label}`, 'success');
    }

    /**
     * Clear all search filters
     */
    clearAllFilters() {
        // Reset all filters to default
        this.searchFilters = {
            date: 'all',
            messages: 'all'
        };

        // Reset button states
        document.querySelectorAll('.filter-btn').forEach(btn => {
            const isDefault = btn.dataset.value === 'all';
            btn.classList.toggle('active', isDefault);
        });

        // Clear other filters too
        this.searchQuery = '';
        this.selectedTagFilter = null;
        this.selectedFolderId = 'all';

        // Update UI
        this.conversationSearch.value = '';
        this.clearSearchBtn.classList.add('hidden');
        this.clearTagFilterBtn.classList.add('hidden');

        // Update folder selection
        document.querySelectorAll('.folder-item').forEach(item => {
            item.classList.toggle('active', item.dataset.folder === 'all');
        });

        // Re-render
        this.renderTagsFilter();
        this.renderConversationsList();

        this.showNotification('All filters cleared', 'success');
    }

    /**
     * Enter bulk selection mode
     */
    enterBulkMode() {
        this.bulkMode = true;
        this.bulkActionsToolbar.classList.remove('hidden');
        this.renderConversationsList();
    }

    /**
     * Exit bulk selection mode
     */
    exitBulkMode() {
        this.bulkMode = false;
        this.selectedConversations.clear();
        this.bulkActionsToolbar.classList.add('hidden');
        if (this.selectAllCheckbox) {
            this.selectAllCheckbox.checked = false;
        }
        this.renderConversationsList();
    }

    /**
     * Update bulk UI (selection count, checkboxes)
     */
    updateBulkUI() {
        const count = this.selectedConversations.size;
        this.bulkSelectionCount.textContent = `${count} selected`;

        // Update select all checkbox state
        const filtered = Object.keys(this.conversations).filter(id => {
            // Apply same filters as renderConversationsList
            const conv = this.conversations[id];

            if (this.selectedFolderId !== 'all' && conv.folderId !== this.selectedFolderId) return false;
            if (this.selectedTagFilter && (!conv.tags || !conv.tags.includes(this.selectedTagFilter))) return false;

            return true;
        });

        if (this.selectAllCheckbox) {
            this.selectAllCheckbox.checked = count > 0 && count === filtered.length;
            this.selectAllCheckbox.indeterminate = count > 0 && count < filtered.length;
        }

        // Update conversation items
        document.querySelectorAll('.conversation-item').forEach(item => {
            const id = item.dataset.id;
            const isSelected = this.selectedConversations.has(id);
            item.classList.toggle('selected', isSelected);

            const checkbox = item.querySelector('.conversation-checkbox');
            if (checkbox) {
                checkbox.checked = isSelected;
            }
        });
    }

    /**
     * Toggle select all conversations
     */
    toggleSelectAll(checked) {
        if (checked) {
            // Select all visible conversations
            document.querySelectorAll('.conversation-item').forEach(item => {
                this.selectedConversations.add(item.dataset.id);
            });

            if (!this.bulkMode) {
                this.enterBulkMode();
            }
        } else {
            // Deselect all
            this.selectedConversations.clear();
            this.exitBulkMode();
        }

        this.updateBulkUI();
    }

    /**
     * Toggle individual conversation selection
     */
    toggleConversationSelection(id) {
        if (this.selectedConversations.has(id)) {
            this.selectedConversations.delete(id);
            if (this.selectedConversations.size === 0) {
                this.exitBulkMode();
            }
        } else {
            this.selectedConversations.add(id);
            if (!this.bulkMode) {
                this.enterBulkMode();
            }
        }

        this.updateBulkUI();
    }

    /**
     * Bulk move conversations to folder
     */
    bulkMoveToFolder() {
        if (this.selectedConversations.size === 0) return;

        // Build folder options
        const options = [
            { id: 'all', name: 'All Conversations' },
            ...this.folders
        ];

        let folderList = options.map((f, i) => `${i + 1}. ${f.name}`).join('\n');
        const choice = prompt(`Move ${this.selectedConversations.size} conversation(s) to:\n\n${folderList}\n\nEnter folder number:`);

        if (!choice) return;

        const index = parseInt(choice) - 1;
        if (isNaN(index) || index < 0 || index >= options.length) {
            this.showNotification('Invalid folder number', 'error');
            return;
        }

        const folderId = options[index].id;
        const folderName = options[index].name;

        // Move all selected conversations
        this.selectedConversations.forEach(id => {
            const conv = this.conversations[id];
            if (!conv) return;

            if (folderId === 'all') {
                delete conv.folderId;
            } else {
                conv.folderId = folderId;
            }
            conv.lastModified = Date.now();
        });

        this.saveConversations();
        this.renderFolders();
        this.exitBulkMode();

        this.showNotification(`${this.selectedConversations.size} conversation(s) moved to "${folderName}"`, 'success');
    }

    /**
     * Bulk add tag to conversations
     */
    bulkAddTag() {
        if (this.selectedConversations.size === 0) return;

        const tag = prompt(`Add tag to ${this.selectedConversations.size} conversation(s):`);
        if (!tag || !tag.trim()) return;

        const normalizedTag = tag.trim().toLowerCase();

        // Add tag to all selected conversations
        this.selectedConversations.forEach(id => {
            const conv = this.conversations[id];
            if (!conv) return;

            if (!conv.tags) {
                conv.tags = [];
            }

            if (!conv.tags.includes(normalizedTag)) {
                conv.tags.push(normalizedTag);
                conv.lastModified = Date.now();
            }
        });

        this.saveConversations();
        this.updateAvailableTags();
        this.renderTagsFilter();
        this.exitBulkMode();

        this.showNotification(`Tag "${normalizedTag}" added to ${this.selectedConversations.size} conversation(s)`, 'success');
    }

    /**
     * Bulk export conversations
     */
    async bulkExport() {
        if (this.selectedConversations.size === 0) return;

        const count = this.selectedConversations.size;
        const timestamp = new Date().toISOString().split('T')[0];
        const filename = `conversations_export_${timestamp}.json`;

        // Collect selected conversations
        const toExport = {};
        this.selectedConversations.forEach(id => {
            if (this.conversations[id]) {
                toExport[id] = this.conversations[id];
            }
        });

        // Export as JSON
        const content = JSON.stringify(toExport, null, 2);
        this.downloadFile(content, filename, 'application/json');

        this.showNotification(`${count} conversation(s) exported`, 'success');
    }

    /**
     * Bulk delete conversations
     */
    async bulkDelete() {
        if (this.selectedConversations.size === 0) return;

        const count = this.selectedConversations.size;
        if (!confirm(`Delete ${count} conversation(s)? This cannot be undone.`)) {
            return;
        }

        // Delete all selected conversations
        for (const id of this.selectedConversations) {
            delete this.conversations[id];

            // Delete from storage manager
            try {
                await this.storageManager.deleteConversation(id);
            } catch (error) {
                console.error(`Failed to delete conversation ${id} from storage:`, error);
            }
        }

        // If current conversation was deleted, load another one
        if (this.selectedConversations.has(this.currentConversationId)) {
            const conversationIds = Object.keys(this.conversations);
            if (conversationIds.length > 0) {
                this.loadConversation(conversationIds[0]);
            } else {
                this.createNewConversation();
            }
        }

        this.renderFolders();
        this.exitBulkMode();

        this.showNotification(`${count} conversation(s) deleted`, 'success');
    }

    /**
     * Open trim modal for audio file
     */
    async openTrimModal(fileIndex) {
        const file = this.selectedFiles[fileIndex];
        if (!file || !file.fileType.startsWith('audio/')) {
            return;
        }

        this.trimFileIndex = fileIndex;
        this.trimStartPercent = 0;
        this.trimEndPercent = 100;

        // Show modal
        this.trimAudioModal.classList.remove('hidden');

        try {
            // Create audio context and decode audio
            this.trimAudioContext = new (window.AudioContext || window.webkitAudioContext)();

            // Fetch and decode audio
            const response = await fetch(file.dataURL);
            const arrayBuffer = await response.arrayBuffer();
            this.trimAudioBuffer = await this.trimAudioContext.decodeAudioData(arrayBuffer);

            // Draw waveform
            this.drawTrimWaveform();

            // Update time displays
            this.updateTrimTimeDisplays();

            // Reset handles to full range
            this.trimHandleStart.style.left = '0%';
            this.trimHandleEnd.style.left = '100%';

        } catch (error) {
            console.error('Failed to load audio for trimming:', error);
            this.showNotification('Failed to load audio file', 'error');
            this.closeTrimModal();
        }
    }

    /**
     * Close trim modal
     */
    closeTrimModal() {
        this.trimAudioModal.classList.add('hidden');

        // Stop any playing audio
        if (this.trimAudioSource) {
            try {
                this.trimAudioSource.stop();
            } catch (e) {
                // Already stopped
            }
            this.trimAudioSource = null;
        }

        // Close audio context
        if (this.trimAudioContext) {
            this.trimAudioContext.close();
            this.trimAudioContext = null;
        }

        this.trimFileIndex = null;
        this.trimAudioBuffer = null;
    }

    /**
     * Draw waveform in trim modal
     */
    drawTrimWaveform() {
        if (!this.trimAudioBuffer || !this.trimWaveform) return;

        const canvas = this.trimWaveform;
        const ctx = canvas.getContext('2d');
        const width = canvas.width;
        const height = canvas.height;

        // Get audio data
        const rawData = this.trimAudioBuffer.getChannelData(0);
        const samples = 200; // Number of bars
        const blockSize = Math.floor(rawData.length / samples);
        const filteredData = [];

        for (let i = 0; i < samples; i++) {
            let blockStart = blockSize * i;
            let sum = 0;
            for (let j = 0; j < blockSize; j++) {
                sum += Math.abs(rawData[blockStart + j]);
            }
            filteredData.push(sum / blockSize);
        }

        // Normalize
        const maxValue = Math.max(...filteredData);
        const normalizedData = filteredData.map(n => n / maxValue);

        // Clear canvas
        ctx.clearRect(0, 0, width, height);

        // Draw waveform bars
        const barWidth = width / samples;
        for (let i = 0; i < normalizedData.length; i++) {
            const barHeight = normalizedData[i] * height * 0.9;
            const x = i * barWidth;
            const y = (height - barHeight) / 2;

            const gradient = ctx.createLinearGradient(0, 0, 0, height);
            gradient.addColorStop(0, '#00D2DD');
            gradient.addColorStop(1, '#3CD7E0');

            ctx.fillStyle = gradient;
            ctx.fillRect(x, y, barWidth - 1, barHeight);
        }
    }

    /**
     * Handle trim handle dragging
     */
    handleTrimDrag(e) {
        if (!this.trimRegion || !this.trimDragging) return;

        const rect = this.trimRegion.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const percent = Math.max(0, Math.min(100, (x / rect.width) * 100));

        if (this.trimDragging === 'start') {
            // Don't allow start to go past end
            if (percent < this.trimEndPercent) {
                this.trimStartPercent = percent;
                this.trimHandleStart.style.left = `${percent}%`;
            }
        } else if (this.trimDragging === 'end') {
            // Don't allow end to go before start
            if (percent > this.trimStartPercent) {
                this.trimEndPercent = percent;
                this.trimHandleEnd.style.left = `${percent}%`;
            }
        }

        this.updateTrimTimeDisplays();
    }

    /**
     * Update trim time displays
     */
    updateTrimTimeDisplays() {
        if (!this.trimAudioBuffer) return;

        const duration = this.trimAudioBuffer.duration;
        const startTime = (this.trimStartPercent / 100) * duration;
        const endTime = (this.trimEndPercent / 100) * duration;
        const trimmedDuration = endTime - startTime;

        this.trimStartTime.textContent = this.formatTime(startTime);
        this.trimEndTime.textContent = this.formatTime(endTime);
        this.trimDuration.textContent = this.formatTime(trimmedDuration);
    }

    /**
     * Preview trimmed audio
     */
    previewTrimmedAudio() {
        if (!this.trimAudioBuffer || !this.trimAudioContext) return;

        // Stop any existing playback
        if (this.trimAudioSource) {
            try {
                this.trimAudioSource.stop();
            } catch (e) {
                // Already stopped
            }
        }

        const duration = this.trimAudioBuffer.duration;
        const startTime = (this.trimStartPercent / 100) * duration;
        const endTime = (this.trimEndPercent / 100) * duration;

        // Create audio source
        this.trimAudioSource = this.trimAudioContext.createBufferSource();
        this.trimAudioSource.buffer = this.trimAudioBuffer;
        this.trimAudioSource.connect(this.trimAudioContext.destination);

        // Play from start time to end time
        this.trimAudioSource.start(0, startTime, endTime - startTime);

        // Update button
        const icon = this.trimPlayBtn.querySelector('.material-icons');
        const text = this.trimPlayBtn.childNodes[2];
        if (icon) icon.textContent = 'stop';
        if (text) text.textContent = ' Stop';

        // Reset button when done
        this.trimAudioSource.onended = () => {
            if (icon) icon.textContent = 'play_arrow';
            if (text) text.textContent = ' Preview';
            this.trimAudioSource = null;
        };
    }

    /**
     * Apply trim to audio file
     */
    async applyTrim() {
        if (this.trimFileIndex === null || !this.trimAudioBuffer || !this.trimAudioContext) {
            return;
        }

        try {
            const duration = this.trimAudioBuffer.duration;
            const startTime = (this.trimStartPercent / 100) * duration;
            const endTime = (this.trimEndPercent / 100) * duration;
            const trimmedDuration = endTime - startTime;

            // If no actual trimming (full range), just close
            if (this.trimStartPercent === 0 && this.trimEndPercent === 100) {
                this.closeTrimModal();
                return;
            }

            // Create new trimmed buffer
            const sampleRate = this.trimAudioBuffer.sampleRate;
            const numberOfChannels = this.trimAudioBuffer.numberOfChannels;
            const startFrame = Math.floor(startTime * sampleRate);
            const endFrame = Math.floor(endTime * sampleRate);
            const frameCount = endFrame - startFrame;

            const trimmedBuffer = this.trimAudioContext.createBuffer(
                numberOfChannels,
                frameCount,
                sampleRate
            );

            // Copy audio data for each channel
            for (let channel = 0; channel < numberOfChannels; channel++) {
                const sourceData = this.trimAudioBuffer.getChannelData(channel);
                const trimmedData = trimmedBuffer.getChannelData(channel);
                for (let i = 0; i < frameCount; i++) {
                    trimmedData[i] = sourceData[startFrame + i];
                }
            }

            // Convert trimmed buffer to blob
            const audioBlob = await this.audioBufferToBlob(trimmedBuffer);

            // Convert to data URL
            const dataURL = await this.blobToDataURL(audioBlob);

            // Update file in selectedFiles
            const file = this.selectedFiles[this.trimFileIndex];
            file.dataURL = dataURL;
            file.fileSize = audioBlob.size;
            file.fileName = file.fileName.replace(/(\.[^.]+)$/, '_trimmed$1');

            // If it was uploaded to Google Drive, we need to re-upload
            if (file.isArtifact && file.gdriveUrl) {
                file.isArtifact = false;
                file.gdriveUrl = null;
                file.uploading = true;

                // Upload new trimmed version
                const syncStatus = this.storageManager.getSyncStatus();
                if (syncStatus.mode === 'online') {
                    this.uploadToGoogleDriveInBackground(audioBlob, file);
                }
            }

            this.renderFilePreview();
            this.closeTrimModal();

            this.showNotification('Audio trimmed successfully', 'success');

        } catch (error) {
            console.error('Failed to trim audio:', error);
            this.showNotification('Failed to trim audio', 'error');
        }
    }

    /**
     * Convert audio buffer to blob
     */
    async audioBufferToBlob(audioBuffer) {
        const numberOfChannels = audioBuffer.numberOfChannels;
        const sampleRate = audioBuffer.sampleRate;
        const format = 1; // PCM
        const bitDepth = 16;

        const bytesPerSample = bitDepth / 8;
        const blockAlign = numberOfChannels * bytesPerSample;

        const data = [];
        for (let channel = 0; channel < numberOfChannels; channel++) {
            data.push(audioBuffer.getChannelData(channel));
        }

        const dataLength = audioBuffer.length * blockAlign;
        const buffer = new ArrayBuffer(44 + dataLength);
        const view = new DataView(buffer);

        // RIFF chunk descriptor
        this.writeString(view, 0, 'RIFF');
        view.setUint32(4, 36 + dataLength, true);
        this.writeString(view, 8, 'WAVE');

        // FMT sub-chunk
        this.writeString(view, 12, 'fmt ');
        view.setUint32(16, 16, true); // fmt chunk size
        view.setUint16(20, format, true); // audio format
        view.setUint16(22, numberOfChannels, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, sampleRate * blockAlign, true); // byte rate
        view.setUint16(32, blockAlign, true);
        view.setUint16(34, bitDepth, true);

        // Data sub-chunk
        this.writeString(view, 36, 'data');
        view.setUint32(40, dataLength, true);

        // Write interleaved audio data
        let offset = 44;
        for (let i = 0; i < audioBuffer.length; i++) {
            for (let channel = 0; channel < numberOfChannels; channel++) {
                const sample = Math.max(-1, Math.min(1, data[channel][i]));
                const int16 = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
                view.setInt16(offset, int16, true);
                offset += 2;
            }
        }

        return new Blob([buffer], { type: 'audio/wav' });
    }

    /**
     * Write string to DataView
     */
    writeString(view, offset, string) {
        for (let i = 0; i < string.length; i++) {
            view.setUint8(offset + i, string.charCodeAt(i));
        }
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
