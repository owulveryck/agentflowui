/**
 * StorageWorker - Handles storage data processing in background
 * Processes and optimizes data for storage without blocking main thread
 */

class StorageManager {
    constructor() {
        this.maxFailures = 3;
    }

    /**
     * Safely truncate content - handles both string and array/object types
     */
    truncateContent(content, maxLength) {
        if (!content) return '';

        if (typeof content === 'string') {
            return content.substring(0, maxLength);
        }

        // For array/object content (multipart messages), convert to string first
        if (Array.isArray(content) || typeof content === 'object') {
            const stringified = JSON.stringify(content);
            return stringified.substring(0, maxLength);
        }

        return String(content).substring(0, maxLength);
    }

    /**
     * Create reduced version of conversations for storage quota issues
     */
    createReducedConversations(conversations) {
        const reduced = {};

        Object.entries(conversations).forEach(([id, conv]) => {
            reduced[id] = {
                title: conv.title,
                systemPrompt: conv.systemPrompt,
                createdAt: conv.createdAt,
                lastModified: conv.lastModified,
                messages: conv.messages ? conv.messages.map(msg => ({
                    role: msg.role,
                    content: this.truncateContent(msg.content, 1000),
                    timestamp: msg.timestamp
                })) : []
            };
        });

        return {
            success: true,
            data: reduced
        };
    }

    /**
     * Calculate storage usage
     */
    calculateStorageUsage(conversations) {
        const totalSize = JSON.stringify(conversations).length;
        const conversationCount = Object.keys(conversations).length;
        const messageCount = Object.values(conversations).reduce((total, conv) =>
            total + (conv.messages ? conv.messages.length : 0), 0
        );

        return {
            totalSize,
            conversationCount,
            messageCount,
            averageConversationSize: conversationCount > 0 ? Math.round(totalSize / conversationCount) : 0,
            averageMessageSize: messageCount > 0 ? Math.round(totalSize / messageCount) : 0
        };
    }
}

// Worker event handling
const storageManager = new StorageManager();

self.onmessage = async function(e) {
    const { type, data, id } = e.data;

    try {
        let result;

        switch (type) {
            case 'createReducedConversations':
                result = storageManager.createReducedConversations(data);
                break;

            case 'calculateStorageUsage':
                result = { success: true, data: storageManager.calculateStorageUsage(data) };
                break;

            default:
                result = { success: false, error: `Unknown operation: ${type}` };
        }

        self.postMessage({ id, type, ...result });
    } catch (error) {
        self.postMessage({
            id,
            type,
            success: false,
            error: error.message
        });
    }
};

// Signal worker is ready
self.postMessage({ type: 'ready' });
