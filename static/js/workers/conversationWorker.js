/**
 * ConversationWorker - Handles conversation data processing
 * Prepares conversations for API requests and storage
 */

class ConversationProcessor {
    constructor() {
        this.compressionThreshold = 50;
    }

    /**
     * Prepare conversation data for API requests
     */
    prepareForAPI(conversation, systemPrompt, selectedModel) {
        try {
            const messages = [];

            // Add system prompt if provided
            if (systemPrompt && systemPrompt.trim()) {
                messages.push({
                    role: 'system',
                    content: systemPrompt
                });
            }

            // Process conversation messages
            if (conversation.messages) {
                conversation.messages.forEach(msg => {
                    if (msg.role === 'user' || msg.role === 'assistant') {
                        messages.push({
                            role: msg.role,
                            content: msg.content
                        });
                    }
                });
            }

            return {
                success: true,
                data: {
                    messages,
                    messageCount: messages.length
                }
            };
        } catch (error) {
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Calculate conversation statistics
     */
    calculateStats(conversations) {
        const stats = {
            totalConversations: Object.keys(conversations).length,
            totalMessages: 0,
            totalSize: 0
        };

        Object.values(conversations).forEach(conv => {
            const messageCount = conv.messages ? conv.messages.length : 0;
            stats.totalMessages += messageCount;
            stats.totalSize += JSON.stringify(conv).length;
        });

        return stats;
    }
}

// Worker event handling
const processor = new ConversationProcessor();

self.onmessage = function(e) {
    const { type, data, id } = e.data;

    try {
        let result;

        switch (type) {
            case 'prepareForAPI':
                result = processor.prepareForAPI(
                    data.conversation,
                    data.systemPrompt,
                    data.selectedModel
                );
                break;

            case 'calculateStats':
                result = { success: true, data: processor.calculateStats(data) };
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
