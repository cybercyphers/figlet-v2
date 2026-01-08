const fs = require('fs');
const path = require('path');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const { writeFile } = require('fs/promises');

const messageStore = new Map();

// Get directories
const PLUGIN_DIR = path.dirname(__filename);
const ROOT_DIR = path.join(PLUGIN_DIR, '..');
const DATA_DIR = path.join(ROOT_DIR, 'data');
const TEMP_MEDIA_DIR = path.join(ROOT_DIR, 'tmp');
const CONFIG_PATH = path.join(DATA_DIR, 'antidelete.json');

// Create directories if they don't exist
function ensureDirectories() {
    try {
        const dirs = [DATA_DIR, TEMP_MEDIA_DIR];
        for (const dir of dirs) {
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
        }
        return true;
    } catch (error) {
        console.error('Error creating directories:', error.message);
        return false;
    }
}

// Initialize directories
ensureDirectories();

// Simple JID extractor - NO jidDecode used
function extractJidParts(jid) {
    if (!jid || typeof jid !== 'string') {
        return { user: 'unknown', server: 'unknown' };
    }
    
    try {
        // Remove any resource part after /
        const baseJid = jid.split('/')[0];
        
        // Find @ symbol
        const atIndex = baseJid.indexOf('@');
        if (atIndex !== -1) {
            return {
                user: baseJid.substring(0, atIndex),
                server: baseJid.substring(atIndex + 1)
            };
        }
        
        // If no @ found, check for : (for phone numbers like 62812:0@s.whatsapp.net)
        const colonIndex = baseJid.indexOf(':');
        if (colonIndex !== -1) {
            const afterColon = baseJid.substring(colonIndex + 1);
            const atIndex2 = afterColon.indexOf('@');
            if (atIndex2 !== -1) {
                return {
                    user: baseJid.substring(0, colonIndex),
                    server: afterColon.substring(atIndex2 + 1)
                };
            }
        }
        
        // Return as is
        return { user: baseJid, server: 's.whatsapp.net' };
    } catch (error) {
        return { user: 'unknown', server: 'unknown' };
    }
}

// Load config from JSON file
function loadAntideleteConfig() {
    try {
        if (!fs.existsSync(CONFIG_PATH)) {
            // Create default config
            const defaultConfig = { enabled: false };
            fs.writeFileSync(CONFIG_PATH, JSON.stringify(defaultConfig, null, 2));
            return defaultConfig;
        }
        
        const data = fs.readFileSync(CONFIG_PATH, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error('Error loading anti-delete config:', error.message);
        return { enabled: false };
    }
}

// Save config to JSON file
function saveAntideleteConfig(config) {
    try {
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
        return true;
    } catch (error) {
        console.error('Error saving anti-delete config:', error.message);
        return false;
    }
}

// Check global config from config.js
function isAntideleteEnabled() {
    try {
        // Check JSON config first
        const jsonConfig = loadAntideleteConfig();
        if (jsonConfig && typeof jsonConfig.enabled === 'boolean') {
            return jsonConfig.enabled;
        }
        
        // Check global config from config.js
        if (typeof global.antidelete === 'boolean') {
            return global.antidelete;
        }
        
        return false;
    } catch (error) {
        return false;
    }
}

// Store incoming messages
async function storeMessage(message, sock) {
    try {
        // Check if anti-delete is enabled
        if (!isAntideleteEnabled()) return;
        
        if (!message || !message.key || !message.key.id) return;
        
        const messageId = message.key.id;
        if (!messageId) return;
        
        let content = '';
        let mediaType = '';
        let mediaPath = '';
        const sender = message.key.participant || message.key.remoteJid || '';
        
        // Extract message content
        const msgContent = message.message || {};
        
        if (msgContent.conversation) {
            content = msgContent.conversation;
        } else if (msgContent.extendedTextMessage?.text) {
            content = msgContent.extendedTextMessage.text;
        } else if (msgContent.imageMessage) {
            mediaType = 'image';
            content = msgContent.imageMessage.caption || '';
            try {
                const buffer = await downloadContentFromMessage(msgContent.imageMessage, 'image');
                mediaPath = path.join(TEMP_MEDIA_DIR, `${messageId}.jpg`);
                await writeFile(mediaPath, buffer);
            } catch (error) {
                // Silent fail for media
            }
        } else if (msgContent.videoMessage) {
            mediaType = 'video';
            content = msgContent.videoMessage.caption || '';
            try {
                const buffer = await downloadContentFromMessage(msgContent.videoMessage, 'video');
                mediaPath = path.join(TEMP_MEDIA_DIR, `${messageId}.mp4`);
                await writeFile(mediaPath, buffer);
            } catch (error) {
                // Silent fail for media
            }
        } else if (msgContent.stickerMessage) {
            mediaType = 'sticker';
            try {
                const buffer = await downloadContentFromMessage(msgContent.stickerMessage, 'sticker');
                mediaPath = path.join(TEMP_MEDIA_DIR, `${messageId}.webp`);
                await writeFile(mediaPath, buffer);
            } catch (error) {
                // Silent fail for media
            }
        }
        
        // Only store if there's content
        if (content.trim() || mediaType) {
            messageStore.set(messageId, {
                content: content.trim(),
                mediaType,
                mediaPath,
                sender,
                group: message.key.remoteJid?.endsWith('@g.us') ? message.key.remoteJid : null,
                timestamp: Date.now()
            });
        }
        
    } catch (error) {
        // Silent error handling
    }
}

// Handle message deletion
async function handleMessageRevocation(sock, revocationMessage) {
    try {
        // Check if anti-delete is enabled
        if (!isAntideleteEnabled()) return;
        
        if (!revocationMessage || !revocationMessage.message?.protocolMessage?.key?.id) {
            return;
        }
        
        const messageId = revocationMessage.message.protocolMessage.key.id;
        const original = messageStore.get(messageId);
        
        if (!original) return;
        
        // Get who deleted the message
        const deletedBy = revocationMessage.participant || revocationMessage.key?.participant || revocationMessage.key?.remoteJid || 'unknown';
        
        // Get bot owner
        let ownerJid = sock.user?.id || '';
        if (!ownerJid.includes('@')) {
            ownerJid = ownerJid.split(':')[0] + '@s.whatsapp.net';
        }
        
        // Skip if bot deleted its own message
        const deletedByParts = extractJidParts(deletedBy);
        const ownerParts = extractJidParts(ownerJid);
        if (deletedByParts.user === ownerParts.user) return;
        
        // Prepare report
        const senderParts = extractJidParts(original.sender);
        const time = new Date(original.timestamp).toLocaleTimeString('en-US', {
            timeZone: 'Asia/Kolkata',
            hour12: true,
            hour: '2-digit',
            minute: '2-digit'
        });
        
        let report = `*🔰 ANTIDELETE ALERT 🔰*\n\n`;
        report += `*❌ Deleted By:* ${deletedByParts.user}\n`;
        report += `*👤 Original Sender:* ${senderParts.user}\n`;
        report += `*🕒 Time:* ${time}\n`;
        
        if (original.group) {
            report += `*💬 Location:* Group Chat\n`;
        } else {
            report += `*💬 Location:* Private Chat\n`;
        }
        
        if (original.content) {
            report += `\n*📝 Message:*\n${original.content}\n`;
        }
        
        if (original.mediaType) {
            report += `\n*📎 Attachment:* ${original.mediaType.toUpperCase()}\n`;
        }
        
        // Send report to bot owner
        await sock.sendMessage(ownerJid, { text: report });
        
        // Send media if available
        if (original.mediaType && original.mediaPath && fs.existsSync(original.mediaPath)) {
            try {
                const mediaOptions = {
                    caption: `Deleted ${original.mediaType} from ${senderParts.user}`
                };
                
                switch (original.mediaType) {
                    case 'image':
                        await sock.sendMessage(ownerJid, {
                            image: { url: original.mediaPath },
                            ...mediaOptions
                        });
                        break;
                    case 'video':
                        await sock.sendMessage(ownerJid, {
                            video: { url: original.mediaPath },
                            ...mediaOptions
                        });
                        break;
                    case 'sticker':
                        await sock.sendMessage(ownerJid, {
                            sticker: { url: original.mediaPath }
                        });
                        break;
                }
            } catch (error) {
                // Silent fail for media sending
            }
            
            // Clean up media file
            try {
                fs.unlinkSync(original.mediaPath);
            } catch (error) {
                // Ignore cleanup errors
            }
        }
        
        // Remove from store
        messageStore.delete(messageId);
        
    } catch (error) {
        // Silent error handling
    }
}

// Clean up old messages from store (older than 1 hour)
setInterval(() => {
    try {
        const now = Date.now();
        const oneHourAgo = now - (60 * 60 * 1000);
        
        for (const [messageId, data] of messageStore.entries()) {
            if (data.timestamp < oneHourAgo) {
                // Clean up media file if exists
                if (data.mediaPath && fs.existsSync(data.mediaPath)) {
                    try {
                        fs.unlinkSync(data.mediaPath);
                    } catch (error) {
                        // Ignore cleanup errors
                    }
                }
                messageStore.delete(messageId);
            }
        }
    } catch (error) {
        // Silent error handling
    }
}, 30 * 60 * 1000); // Run every 30 minutes

// Plugin structure
module.exports = {
    name: 'antidelete',
    description: 'Track deleted messages and notify bot owner',
    category: 'utility',
    ownerOnly: true,
    
    async execute(bot, m, args) {
        try {
            const config = loadAntideleteConfig();
            const isEnabled = isAntideleteEnabled();
            
            if (!args[0]) {
                // Show status
                let statusText = '';
                if (typeof global.antidelete === 'boolean') {
                    statusText = `Global Config: ${global.antidelete ? '✅ ON' : '❌ OFF'}\n`;
                }
                
                await bot.sendMessage(m.chat, {
                    text: `*🛡️ ANTIDELETE SYSTEM*\n\n` +
                          `${statusText}` +
                          `Current Status: ${isEnabled ? '✅ ACTIVE' : '❌ INACTIVE'}\n\n` +
                          `*Commands:*\n` +
                          `• antidelete on - Enable protection\n` +
                          `• antidelete off - Disable protection\n\n` +
                          `*Note:* Only bot owner can use this`
                }, { quoted: m });
                return;
            }
            
            const action = args[0].toLowerCase();
            
            if (action === 'on') {
                config.enabled = true;
                saveAntideleteConfig(config);
                await bot.sendMessage(m.chat, {
                    text: '✅ *Anti-delete activated*\n\nNow monitoring all deleted messages. Reports will be sent to bot owner.'
                }, { quoted: m });
            } 
            else if (action === 'off') {
                config.enabled = false;
                saveAntideleteConfig(config);
                await bot.sendMessage(m.chat, {
                    text: '❌ *Anti-delete deactivated*'
                }, { quoted: m });
            }
            else {
                await bot.sendMessage(m.chat, {
                    text: '❓ *Usage:* antidelete on/off'
                }, { quoted: m });
            }
            
        } catch (error) {
            await bot.sendMessage(m.chat, {
                text: `⚠️ Error: ${error.message}`
            }, { quoted: m });
        }
    },
    
    // Message handler
    onMessage: async (bot, message) => {
        await storeMessage(message, bot);
    },
    
    // Deletion handler
    onMessageDelete: async (bot, deletionMessage) => {
        await handleMessageRevocation(bot, deletionMessage);
    }
};
