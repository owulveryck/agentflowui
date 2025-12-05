/**
 * Google Drive Storage Service
 * Handles file operations with Google Drive API
 */
class GoogleDriveStorage {
    constructor(auth) {
        this.auth = auth;
        this.baseUrl = 'https://www.googleapis.com/drive/v3';
        this.uploadUrl = 'https://www.googleapis.com/upload/drive/v3';

        // Folder IDs (will be initialized)
        this.appFolderId = null;
        this.conversationsFolderId = null;
        this.artifactsFolderId = null;

        this.initialized = false;
    }

    /**
     * Initialize folder structure
     */
    async init() {
        if (this.initialized) return true;

        if (!this.auth.isAuthenticated()) {
            throw new Error('Not authenticated');
        }

        try {
            // Create/find app folder structure
            this.appFolderId = await this.getOrCreateFolder('AgentFlowUI', 'root');
            this.conversationsFolderId = await this.getOrCreateFolder('conversations', this.appFolderId);
            this.artifactsFolderId = await this.getOrCreateFolder('artifacts', this.appFolderId);

            this.initialized = true;
            return true;
        } catch (error) {
            console.error('Failed to initialize Google Drive folders:', error);
            throw error;
        }
    }

    /**
     * Get or create a folder
     */
    async getOrCreateFolder(name, parentId) {
        const token = await this.auth.getAccessToken();
        if (!token) throw new Error('No access token');

        // Search for existing folder
        const query = `name='${name}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;

        const searchResponse = await fetch(
            `${this.baseUrl}/files?q=${encodeURIComponent(query)}&fields=files(id,name)`,
            {
                headers: { 'Authorization': `Bearer ${token}` }
            }
        );

        if (!searchResponse.ok) {
            throw new Error(`Failed to search folder: ${searchResponse.statusText}`);
        }

        const searchData = await searchResponse.json();

        // Return existing folder
        if (searchData.files && searchData.files.length > 0) {
            return searchData.files[0].id;
        }

        // Create new folder
        const createResponse = await fetch(`${this.baseUrl}/files`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                name: name,
                mimeType: 'application/vnd.google-apps.folder',
                parents: [parentId]
            })
        });

        if (!createResponse.ok) {
            throw new Error(`Failed to create folder: ${createResponse.statusText}`);
        }

        const folder = await createResponse.json();
        return folder.id;
    }

    /**
     * Find a file by name in a folder
     */
    async findFile(fileName, parentId) {
        const token = await this.auth.getAccessToken();
        if (!token) return null;

        const query = `name='${fileName}' and '${parentId}' in parents and trashed=false`;

        const response = await fetch(
            `${this.baseUrl}/files?q=${encodeURIComponent(query)}&fields=files(id,name,modifiedTime)`,
            {
                headers: { 'Authorization': `Bearer ${token}` }
            }
        );

        if (!response.ok) return null;

        const data = await response.json();
        return data.files && data.files.length > 0 ? data.files[0] : null;
    }

    /**
     * Save a conversation to Google Drive
     */
    async saveConversation(conversation) {
        await this.init();

        const fileName = `${conversation.id}.json`;
        const content = JSON.stringify(conversation, null, 2);

        // Check if file already exists
        const existingFile = await this.findFile(fileName, this.conversationsFolderId);

        if (existingFile) {
            // Update existing file
            return await this.updateFile(existingFile.id, content, 'application/json');
        } else {
            // Create new file
            return await this.createFile(
                fileName,
                content,
                this.conversationsFolderId,
                'application/json'
            );
        }
    }

    /**
     * Create a new file in Google Drive
     */
    async createFile(name, content, parentId, mimeType = 'application/json') {
        const token = await this.auth.getAccessToken();
        if (!token) throw new Error('No access token');

        const metadata = {
            name: name,
            parents: [parentId],
            mimeType: mimeType
        };

        // Use multipart upload
        const boundary = '-------314159265358979323846';
        const delimiter = "\r\n--" + boundary + "\r\n";
        const closeDelimiter = "\r\n--" + boundary + "--";

        const multipartRequestBody =
            delimiter +
            'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
            JSON.stringify(metadata) +
            delimiter +
            `Content-Type: ${mimeType}\r\n\r\n` +
            content +
            closeDelimiter;

        const response = await fetch(
            `${this.uploadUrl}/files?uploadType=multipart&fields=id,name,modifiedTime`,
            {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': `multipart/related; boundary=${boundary}`
                },
                body: multipartRequestBody
            }
        );

        if (!response.ok) {
            throw new Error(`Failed to create file: ${response.statusText}`);
        }

        return await response.json();
    }

    /**
     * Update an existing file in Google Drive
     */
    async updateFile(fileId, content, mimeType = 'application/json') {
        const token = await this.auth.getAccessToken();
        if (!token) throw new Error('No access token');

        const response = await fetch(
            `${this.uploadUrl}/files/${fileId}?uploadType=media&fields=id,name,modifiedTime`,
            {
                method: 'PATCH',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': mimeType
                },
                body: content
            }
        );

        if (!response.ok) {
            throw new Error(`Failed to update file: ${response.statusText}`);
        }

        return await response.json();
    }

    /**
     * Upload an artifact (audio, image, etc.) to Google Drive
     */
    async uploadArtifact(blob, fileName) {
        await this.init();

        const token = await this.auth.getAccessToken();
        if (!token) throw new Error('No access token');

        // Check if file already exists (by name)
        const existingFile = await this.findFile(fileName, this.artifactsFolderId);

        if (existingFile) {
            // Return existing file ID
            return `gdrive://${existingFile.id}`;
        }

        // Create metadata
        const metadata = {
            name: fileName,
            parents: [this.artifactsFolderId]
        };

        // Use multipart upload
        const boundary = '-------314159265358979323846';
        const delimiter = "\r\n--" + boundary + "\r\n";
        const closeDelimiter = "\r\n--" + boundary + "--";

        // Read blob as base64
        const blobData = await blob.arrayBuffer();
        const blobArray = new Uint8Array(blobData);

        const multipartRequestBody =
            delimiter +
            'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
            JSON.stringify(metadata) +
            delimiter +
            `Content-Type: ${blob.type}\r\n\r\n`;

        // Convert to blob for upload
        const textEncoder = new TextEncoder();
        const metadataBlob = new Blob([textEncoder.encode(multipartRequestBody)]);
        const closingBlob = new Blob([textEncoder.encode(closeDelimiter)]);
        const uploadBlob = new Blob([metadataBlob, blob, closingBlob]);

        const response = await fetch(
            `${this.uploadUrl}/files?uploadType=multipart&fields=id,name`,
            {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': `multipart/related; boundary=${boundary}`
                },
                body: uploadBlob
            }
        );

        if (!response.ok) {
            throw new Error(`Failed to upload artifact: ${response.statusText}`);
        }

        const file = await response.json();
        return `gdrive://${file.id}`;
    }

    /**
     * Load all conversations from Google Drive
     */
    async loadConversations() {
        await this.init();

        const token = await this.auth.getAccessToken();
        if (!token) throw new Error('No access token');

        // List all files in conversations folder
        const query = `'${this.conversationsFolderId}' in parents and trashed=false`;
        const response = await fetch(
            `${this.baseUrl}/files?q=${encodeURIComponent(query)}&fields=files(id,name,modifiedTime)`,
            {
                headers: { 'Authorization': `Bearer ${token}` }
            }
        );

        if (!response.ok) {
            throw new Error(`Failed to list conversations: ${response.statusText}`);
        }

        const data = await response.json();
        const conversations = {};

        // Download each conversation file
        for (const file of data.files) {
            try {
                const content = await this.downloadFile(file.id);
                const conv = JSON.parse(content);
                conversations[conv.id] = conv;
            } catch (error) {
                console.error(`Failed to load conversation ${file.name}:`, error);
            }
        }

        return conversations;
    }

    /**
     * Download a file from Google Drive
     */
    async downloadFile(fileId) {
        const token = await this.auth.getAccessToken();
        if (!token) throw new Error('No access token');

        const response = await fetch(
            `${this.baseUrl}/files/${fileId}?alt=media`,
            {
                headers: { 'Authorization': `Bearer ${token}` }
            }
        );

        if (!response.ok) {
            throw new Error(`Failed to download file: ${response.statusText}`);
        }

        return await response.text();
    }

    /**
     * Download an artifact and convert to data URL
     */
    async downloadArtifact(fileId) {
        const token = await this.auth.getAccessToken();
        if (!token) throw new Error('No access token');

        const response = await fetch(
            `${this.baseUrl}/files/${fileId}?alt=media`,
            {
                headers: { 'Authorization': `Bearer ${token}` }
            }
        );

        if (!response.ok) {
            throw new Error(`Failed to download artifact: ${response.statusText}`);
        }

        const blob = await response.blob();
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    }

    /**
     * Delete a conversation from Google Drive
     */
    async deleteConversation(conversationId) {
        await this.init();

        const fileName = `${conversationId}.json`;
        const file = await this.findFile(fileName, this.conversationsFolderId);

        if (!file) {
            return true; // Already deleted
        }

        const token = await this.auth.getAccessToken();
        if (!token) throw new Error('No access token');

        const response = await fetch(
            `${this.baseUrl}/files/${file.id}`,
            {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            }
        );

        if (!response.ok && response.status !== 404) {
            throw new Error(`Failed to delete conversation: ${response.statusText}`);
        }

        return true;
    }

    /**
     * Get storage quota information
     */
    async getStorageInfo() {
        const token = await this.auth.getAccessToken();
        if (!token) return null;

        const response = await fetch(
            `${this.baseUrl}/about?fields=storageQuota`,
            {
                headers: { 'Authorization': `Bearer ${token}` }
            }
        );

        if (!response.ok) return null;

        const data = await response.json();
        return data.storageQuota;
    }

    /**
     * Export conversation as Google Doc (upload markdown, auto-convert)
     */
    async exportToGoogleDocs(markdownContent, title) {
        await this.init();

        const token = await this.auth.getAccessToken();
        if (!token) throw new Error('No access token');

        try {
            const metadata = {
                name: `${title} - ${new Date().toLocaleDateString()}`,
                mimeType: 'application/vnd.google-apps.document',
                parents: [this.appFolderId]
            };

            // Create multipart upload
            const boundary = 'boundary_' + Date.now();
            const delimiter = "\r\n--" + boundary + "\r\n";
            const closeDelimiter = "\r\n--" + boundary + "--";

            const multipartRequestBody =
                delimiter +
                'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
                JSON.stringify(metadata) +
                delimiter +
                'Content-Type: text/markdown\r\n\r\n' +
                markdownContent +
                closeDelimiter;

            const response = await fetch(
                `${this.uploadUrl}/files?uploadType=multipart&fields=id,name`,
                {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': `multipart/related; boundary="${boundary}"`
                    },
                    body: multipartRequestBody
                }
            );

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error?.message || 'Failed to create Google Doc');
            }

            const file = await response.json();
            console.log('Google Doc created:', file.id);

            return {
                id: file.id,
                url: `https://docs.google.com/document/d/${file.id}/edit`
            };
        } catch (error) {
            console.error('Failed to export to Google Docs:', error);
            throw error;
        }
    }
}
