/**
 * MessageWorker - Handles message content processing
 * Processes markdown, search, and export functionality
 */

class MessageProcessor {
    /**
     * Process message content for display
     */
    processMessageContent(message) {
        try {
            const processed = {
                ...message,
                hasCode: false,
                hasAttachments: false
            };

            // Check for code blocks
            if (message.content && typeof message.content === 'string') {
                processed.hasCode = /```[\s\S]*?```|`[^`]+`/.test(message.content);
            }

            // Check for attachments
            if (Array.isArray(message.content)) {
                processed.hasAttachments = message.content.some(
                    item => item.type === 'image_url' || item.type === 'audio' || item.type === 'file'
                );
            }

            return {
                success: true,
                data: processed
            };
        } catch (error) {
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Export conversation as JSON
     */
    exportAsJSON(conversation) {
        const exportData = {
            title: conversation.title || 'Untitled Conversation',
            createdAt: conversation.createdAt,
            exportedAt: new Date().toISOString(),
            messageCount: conversation.messages ? conversation.messages.length : 0,
            messages: conversation.messages || []
        };

        return {
            success: true,
            data: {
                content: JSON.stringify(exportData, null, 2),
                filename: `${this.sanitizeFilename(exportData.title)}_${new Date().toISOString().split('T')[0]}.json`,
                mimeType: 'application/json'
            }
        };
    }

    /**
     * Export conversation as Markdown
     */
    exportAsMarkdown(conversation) {
        const title = conversation.title || 'Untitled Conversation';
        const date = conversation.createdAt ? new Date(conversation.createdAt).toLocaleString() : 'Unknown';

        let markdown = `# ${title}\n\n`;
        markdown += `**Created:** ${date}\n`;
        markdown += `**Exported:** ${new Date().toLocaleString()}\n\n`;
        markdown += `---\n\n`;

        if (conversation.messages) {
            conversation.messages.forEach((message, index) => {
                const role = message.role === 'user' ? '👤 User' : '🤖 Assistant';
                const timestamp = message.timestamp ? new Date(message.timestamp).toLocaleTimeString() : '';

                markdown += `## ${role}${timestamp ? ` (${timestamp})` : ''}\n\n`;

                if (typeof message.content === 'string') {
                    markdown += `${message.content}\n\n`;
                } else if (Array.isArray(message.content)) {
                    message.content.forEach(item => {
                        if (item.type === 'text') {
                            markdown += `${item.text}\n\n`;
                        }
                    });
                }

                if (index < conversation.messages.length - 1) {
                    markdown += `---\n\n`;
                }
            });
        }

        return {
            success: true,
            data: {
                content: markdown,
                filename: `${this.sanitizeFilename(title)}_${new Date().toISOString().split('T')[0]}.md`,
                mimeType: 'text/markdown'
            }
        };
    }

    /**
     * Sanitize filename for download
     */
    sanitizeFilename(filename) {
        return filename
            .replace(/[^a-z0-9]/gi, '_')
            .replace(/_+/g, '_')
            .replace(/^_|_$/g, '')
            .toLowerCase()
            .substring(0, 50) || 'conversation';
    }
}

// Worker event handling
const messageProcessor = new MessageProcessor();

self.onmessage = async function(e) {
    const { type, data, id } = e.data;

    try {
        let result;

        switch (type) {
            case 'processMessageContent':
                result = messageProcessor.processMessageContent(data);
                break;

            case 'exportAsJSON':
                result = messageProcessor.exportAsJSON(data);
                break;

            case 'exportAsMarkdown':
                result = messageProcessor.exportAsMarkdown(data);
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
