/**
 * Hybrid Storage Manager
 * Manages local IndexedDB cache and Google Drive sync
 */
class StorageManager {
    constructor() {
        this.auth = new GoogleDriveAuth();
        this.googleDrive = new GoogleDriveStorage(this.auth);
        this.db = null;
        this.syncMode = 'offline'; // 'offline', 'online', 'syncing'
        this.syncInProgress = false;
        this.autoSyncInterval = null;
        this.lastSyncTime = null;
        this.eventListeners = {};
    }

    /**
     * Initialize storage
     */
    async init() {
        // Initialize IndexedDB
        this.db = await this.initIndexedDB();

        // Check if already authenticated
        if (this.auth.isAuthenticated()) {
            await this.switchToOnlineMode();
        }

        return true;
    }

    /**
     * Initialize IndexedDB
     */
    initIndexedDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open('AgentFlowDB', 2);

            request.onerror = () => {
                console.error('IndexedDB error:', request.error);
                reject(request.error);
            };

            request.onsuccess = () => {
                resolve(request.result);
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;

                // Conversations store
                if (!db.objectStoreNames.contains('conversations')) {
                    const convStore = db.createObjectStore('conversations', { keyPath: 'id' });
                    convStore.createIndex('lastModified', 'lastModified', { unique: false });
                }

                // Artifacts store
                if (!db.objectStoreNames.contains('artifacts')) {
                    db.createObjectStore('artifacts', { keyPath: 'id' });
                }

                // Sync queue store
                if (!db.objectStoreNames.contains('syncQueue')) {
                    const syncStore = db.createObjectStore('syncQueue', { keyPath: 'id', autoIncrement: true });
                    syncStore.createIndex('timestamp', 'timestamp', { unique: false });
                    syncStore.createIndex('type', 'type', { unique: false });
                }

                // Metadata store
                if (!db.objectStoreNames.contains('metadata')) {
                    db.createObjectStore('metadata', { keyPath: 'key' });
                }
            };
        });
    }

    /**
     * Event emitter
     */
    on(event, callback) {
        if (!this.eventListeners[event]) {
            this.eventListeners[event] = [];
        }
        this.eventListeners[event].push(callback);
    }

    emit(event, data) {
        if (this.eventListeners[event]) {
            this.eventListeners[event].forEach(callback => callback(data));
        }
    }

    /**
     * Connect to Google Drive
     */
    async connectGoogleDrive() {
        // Set up success callback for when authentication completes
        this.auth.onAuthSuccess = async () => {
            this.emit('auth-success');
            await this.switchToOnlineMode();
        };

        // Trigger login flow
        await this.auth.login();
    }

    /**
     * Disconnect from Google Drive
     */
    async disconnectGoogleDrive() {
        await this.auth.logout();
        this.syncMode = 'offline';
        this.emit('sync-mode-changed', 'offline');

        if (this.autoSyncInterval) {
            clearInterval(this.autoSyncInterval);
            this.autoSyncInterval = null;
        }
    }

    /**
     * Switch to online mode
     */
    async switchToOnlineMode() {
        try {
            await this.googleDrive.init();
            this.syncMode = 'online';
            this.emit('sync-mode-changed', 'online');

            // Perform initial sync
            await this.fullSync();

            // Start auto-sync (every 5 minutes)
            if (!this.autoSyncInterval) {
                this.autoSyncInterval = setInterval(() => {
                    this.processSyncQueue();
                }, 5 * 60 * 1000);
            }
        } catch (error) {
            console.error('Failed to switch to online mode:', error);
            this.syncMode = 'offline';
            this.emit('sync-error', error);
        }
    }

    /**
     * Save conversation (local + queue for sync)
     */
    async saveConversation(conversation) {
        // Always save to local DB first (fast)
        await this.saveToLocal('conversations', conversation);

        // Queue for Google Drive sync if online
        if (this.syncMode === 'online') {
            await this.queueSync('conversation', conversation.id);
            // Process queue immediately (non-blocking)
            setTimeout(() => this.processSyncQueue(), 100);
        }
    }

    /**
     * Load all conversations
     */
    async loadConversations() {
        return await this.getAllFromLocal('conversations');
    }

    /**
     * Delete conversation
     */
    async deleteConversation(conversationId) {
        const tx = this.db.transaction(['conversations'], 'readwrite');
        const store = tx.objectStore('conversations');
        await store.delete(conversationId);

        // Queue delete for sync
        if (this.syncMode === 'online') {
            await this.queueSync('delete-conversation', conversationId);
            setTimeout(() => this.processSyncQueue(), 100);
        }
    }

    /**
     * Save to local IndexedDB
     */
    async saveToLocal(storeName, data) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction([storeName], 'readwrite');
            const store = tx.objectStore(storeName);
            const request = store.put(data);

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Get from local IndexedDB
     */
    async getFromLocal(storeName, id) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction([storeName], 'readonly');
            const store = tx.objectStore(storeName);
            const request = store.get(id);

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Get all from local IndexedDB
     */
    async getAllFromLocal(storeName) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction([storeName], 'readonly');
            const store = tx.objectStore(storeName);
            const request = store.getAll();

            request.onsuccess = () => {
                const items = request.result;
                const result = {};
                items.forEach(item => {
                    result[item.id] = item;
                });
                resolve(result);
            };
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Queue item for sync
     */
    async queueSync(type, id) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(['syncQueue'], 'readwrite');
            const store = tx.objectStore('syncQueue');

            // Check if already queued
            const index = store.index('type');
            const checkRequest = index.getAll(type);

            checkRequest.onsuccess = () => {
                const existing = checkRequest.result.find(item => item.itemId === id);
                if (existing) {
                    resolve(); // Already queued
                    return;
                }

                // Add to queue
                const request = store.add({
                    type: type,
                    itemId: id,
                    timestamp: Date.now()
                });

                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            };

            checkRequest.onerror = () => reject(checkRequest.error);
        });
    }

    /**
     * Process sync queue
     */
    async processSyncQueue() {
        if (this.syncInProgress || this.syncMode !== 'online') {
            return;
        }

        this.syncInProgress = true;
        this.emit('sync-started');

        try {
            const tx = this.db.transaction(['syncQueue', 'conversations'], 'readwrite');
            const queueStore = tx.objectStore('syncQueue');
            const convStore = tx.objectStore('conversations');

            const queueRequest = queueStore.getAll();

            queueRequest.onsuccess = async () => {
                const queue = queueRequest.result;

                for (const item of queue) {
                    try {
                        if (item.type === 'conversation') {
                            const convRequest = convStore.get(item.itemId);
                            convRequest.onsuccess = async () => {
                                const conv = convRequest.result;
                                if (conv) {
                                    await this.googleDrive.saveConversation(conv);
                                    await this.removeFromQueue(item.id);
                                }
                            };
                        } else if (item.type === 'delete-conversation') {
                            await this.googleDrive.deleteConversation(item.itemId);
                            await this.removeFromQueue(item.id);
                        }
                    } catch (error) {
                        console.error('Sync item failed:', item, error);
                        // Keep in queue for retry
                    }
                }

                this.syncInProgress = false;
                this.lastSyncTime = Date.now();
                this.emit('sync-completed');
            };

            queueRequest.onerror = () => {
                this.syncInProgress = false;
                this.emit('sync-error', queueRequest.error);
            };
        } catch (error) {
            this.syncInProgress = false;
            this.emit('sync-error', error);
        }
    }

    /**
     * Remove item from sync queue
     */
    async removeFromQueue(id) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(['syncQueue'], 'readwrite');
            const store = tx.objectStore('syncQueue');
            const request = store.delete(id);

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Full bidirectional sync
     */
    async fullSync() {
        if (this.syncMode !== 'online') {
            throw new Error('Not in online mode');
        }

        this.emit('full-sync-started');

        try {
            // Get local conversations
            const localConvs = await this.getAllFromLocal('conversations');
            console.log(`Full sync: Found ${Object.keys(localConvs).length} local conversations`);

            // Get Google Drive conversations
            const driveConvs = await this.googleDrive.loadConversations();
            console.log(`Full sync: Found ${Object.keys(driveConvs).length} Google Drive conversations`);

            // Merge (last modified wins)
            const merged = this.mergeConversations(localConvs, driveConvs);
            console.log(`Full sync: Merged into ${Object.keys(merged).length} conversations`);

            // Update local storage
            for (const convId in merged) {
                await this.saveToLocal('conversations', merged[convId]);
            }

            // Update Google Drive (through queue to avoid rate limits)
            for (const convId in merged) {
                await this.queueSync('conversation', convId);
            }

            await this.processSyncQueue();

            this.lastSyncTime = Date.now();
            this.emit('full-sync-completed', merged);
            return merged;
        } catch (error) {
            this.emit('sync-error', error);
            throw error;
        }
    }

    /**
     * Merge conversations (last modified wins)
     */
    mergeConversations(local, remote) {
        const merged = {};

        // Add all local conversations
        for (const id in local) {
            merged[id] = local[id];
        }

        // Merge remote conversations (last modified wins)
        for (const id in remote) {
            if (!merged[id]) {
                merged[id] = remote[id];
            } else {
                const localTime = merged[id].lastModified || 0;
                const remoteTime = remote[id].lastModified || 0;

                if (remoteTime > localTime) {
                    merged[id] = remote[id];
                }
            }
        }

        return merged;
    }

    /**
     * Upload artifact to Google Drive
     */
    async uploadArtifact(blob, fileName) {
        if (this.syncMode === 'online') {
            try {
                return await this.googleDrive.uploadArtifact(blob, fileName);
            } catch (error) {
                console.error('Failed to upload artifact to Google Drive:', error);
                throw error;
            }
        } else {
            throw new Error('Google Drive not connected');
        }
    }

    /**
     * Download artifact from Google Drive
     */
    async downloadArtifact(gdriveUrl) {
        if (!gdriveUrl.startsWith('gdrive://')) {
            throw new Error('Invalid Google Drive URL');
        }

        const fileId = gdriveUrl.replace('gdrive://', '');
        return await this.googleDrive.downloadArtifact(fileId);
    }

    /**
     * Get sync status
     */
    getSyncStatus() {
        return {
            mode: this.syncMode,
            authenticated: this.auth.isAuthenticated(),
            syncing: this.syncInProgress,
            lastSyncTime: this.lastSyncTime
        };
    }

    /**
     * Get storage statistics
     */
    async getStorageStats() {
        const localConvs = await this.getAllFromLocal('conversations');
        const localCount = Object.keys(localConvs).length;

        const stats = {
            local: {
                conversations: localCount
            }
        };

        if (this.syncMode === 'online') {
            try {
                const quota = await this.googleDrive.getStorageInfo();
                stats.googleDrive = quota;
            } catch (error) {
                console.error('Failed to get Google Drive stats:', error);
            }
        }

        return stats;
    }
}
