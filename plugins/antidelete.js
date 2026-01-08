const fs = require('fs');
const path = require('path');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const { writeFile } = require('fs/promises');

const messageStore = new Map();
const CONFIG_PATH = path.join(__dirname, '../data/antidelete.json');
const TEMP_MEDIA_DIR = path.join(__dirname, '../tmp');

// Ensure directories exist
if (!fs.existsSync(TEMP_MEDIA_DIR)) {
    fs.mkdirSync(TEMP_MEDIA_DIR, { recursive: true });
}
if (!fs.existsSync(path.dirname(CONFIG_PATH))) {
    fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
}

// Safe JID extractor (without jidDecode)
function extractJidInfo(jid) {
    if (!jid) return { user: 'unknown', server: 'unknown' };
    
    try {
        // Remove any resource part after /
        const baseJid = jid.split('/')[0];
        
        // Extract user and server
        const atIndex = baseJid.indexOf('@');
        if (atIndex !== -1) {
            return {
                user: baseJid.substring(0, atIndex),
                server: baseJid.substring(atIndex + 1)
            };
        }
        
        // If no @ found, try to extract from colon format
        const colonIndex = baseJid.indexOf(':');
        if (colonIndex !== -1) {
            const user = baseJid.substring(0, colonIndex);
            const rest = baseJid.substring(colonIndex + 1);
            const serverAt = rest.indexOf('@');
            if (serverAt !== -1) {
                return {
                    user: user,
                    server: rest.substring(serverAt + 1)
                };
            }
        }
        
        return { user: baseJid, server: 's.whatsapp.net' };
    } catch (error) {
        return { user: 'unknown', server: 'unknown' };
    }
}

// Load config
function loadAntideleteConfig() {
    try {
        if (!fs.existsSync(CONFIG_PATH)) {
            const defaultConfig = { enabled: false };
            fs.writeFileSync(CONFIG_PATH, JSON.stringify(defaultConfig, null, 2));
            return defaultConfig;
        }
        const data = fs.readFileSync(CONFIG_PATH, 'utf8');
        return JSON.parse(data);
    } catch {
        return { enabled: false };
    }
}

// Save config
function saveAntideleteConfig(config) {
    try {
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
        return true;
    } catch {
        return false;
    }
}

// Store incoming messages
async function storeMessage(message, sock) {
    try {
        const config = loadAntideleteConfig();
        if (!config.enabled || !message || !message.key) return;

        const messageId = message.key.id;
        if (!messageId) return;

        let content = '';
        let mediaType = '';
        let mediaPath = '';
        const sender = message.key.participant || message.key.remoteJid;

        // Extract message content
        if (message.message?.conversation) {
            content = message.message.conversation;
        } else if (message.message?.extendedTextMessage?.text) {
            content = message.message.extendedTextMessage.text;
        } else if (message.message?.imageMessage) {
            mediaType = 'image';
            content = message.message.imageMessage.caption || '';
            try {
                const buffer = await downloadContentFromMessage(message.message.imageMessage, 'image');
                mediaPath = path.join(TEMP_MEDIA_DIR, `${messageId}.jpg`);
                await writeFile(mediaPath, buffer);
            } catch (mediaError) {
                console.log('Failed to store image:', mediaError.message);
            }
        } else if (message.message?.stickerMessage) {
            mediaType = 'sticker';
            try {
                const buffer = await downloadContentFromMessage(message.message.stickerMessage, 'sticker');
                mediaPath = path.join(TEMP_MEDIA_DIR, `${messageId}.webp`);
                await writeFile(mediaPath, buffer);
            } catch (mediaError) {
                console.log('Failed to store sticker:', mediaError.message);
            }
        } else if (message.message?.videoMessage) {
            mediaType = 'video';
            content = message.message.videoMessage.caption || '';
            try {
                const buffer = await downloadContentFromMessage(message.message.videoMessage, 'video');
                mediaPath = path.join(TEMP_MEDIA_DIR, `${messageId}.mp4`);
                await writeFile(mediaPath, buffer);
            } catch (mediaError) {
                console.log('Failed to store video:', mediaError.message);
            }
        }

        // Only store if there's content
        if (content || mediaType) {
            messageStore.set(messageId, {
                content,
                mediaType,
                mediaPath,
                sender,
                group: message.key.remoteJid?.endsWith('@g.us') ? message.key.remoteJid : null,
                timestamp: new Date().toISOString()
            });
        }

    } catch (error) {
        console.log('Store message error:', error.message);
    }
}

// Handle message deletion
async function handleMessageRevocation(sock, revocationMessage) {
    try {
        const config = loadAntideleteConfig();
        if (!config.enabled || !revocationMessage || !revocationMessage.message?.protocolMessage?.key) {
            return;
        }

        const messageId = revocationMessage.message.protocolMessage.key.id;
        if (!messageId) return;

        const deletedBy = revocationMessage.participant || revocationMessage.key.participant || revocationMessage.key.remoteJid;
        const original = messageStore.get(messageId);
        
        if (!original) return;

        // Get bot owner info
        let ownerNumber = sock.user?.id || '';
        const ownerInfo = extractJidInfo(ownerNumber);
        
        // Skip if bot deleted its own message
        const deletedByInfo = extractJidInfo(deletedBy);
        if (deletedByInfo.user === ownerInfo.user) return;

        // Prepare report
        const senderInfo = extractJidInfo(original.sender);
        const time = new Date().toLocaleString('en-US', {
            timeZone: 'Asia/Kolkata',
            hour12: true,
            hour: '2-digit',
            minute: '2-digit',
            day: '2-digit',
            month: 'short',
            year: 'numeric'
        });

        let report = `*🔰 ANTIDELETE REPORT 🔰*\n\n`;
        report += `*🗑️ Deleted By:* ${deletedByInfo.user}\n`;
        report += `*👤 Sender:* ${senderInfo.user}\n`;
        report += `*🕒 Time:* ${time}\n`;

        if (original.group) {
            report += `*💬 Chat Type:* Group\n`;
        } else {
            report += `*💬 Chat Type:* Private\n`;
        }

        if (original.content) {
            report += `\n*📝 Message:*\n${original.content.substring(0, 500)}${original.content.length > 500 ? '...' : ''}\n`;
        }

        if (original.mediaType) {
            report += `\n*📎 Media Type:* ${original.mediaType.toUpperCase()}\n`;
        }

        // Send to bot owner
        const ownerJid = `${ownerInfo.user}@${ownerInfo.server}`;
        
        await sock.sendMessage(ownerJid, { text: report });

        // Send media if available
        if (original.mediaType && original.mediaPath && fs.existsSync(original.mediaPath)) {
            try {
                const mediaOptions = {
                    caption: `Deleted ${original.mediaType} from ${senderInfo.user}`
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
                            sticker: { url: original.mediaPath },
                            ...mediaOptions
                        });
                        break;
                }
            } catch (mediaError) {
                console.log('Failed to send media:', mediaError.message);
            }

            // Clean up media file
            try {
                fs.unlinkSync(original.mediaPath);
            } catch (unlinkError) {
                // Ignore cleanup errors
            }
        }

        // Remove from store
        messageStore.delete(messageId);

    } catch (error) {
        console.log('Message revocation error:', error.message);
    }
}

// Plugin structure
module.exports = {
    name: 'antidelete',
    description: 'Track deleted messages and notify bot owner',
    category: 'utility',
    ownerOnly: true,
    
    async execute(bot, m, args) {
        try {
            const config = loadAntideleteConfig();
            
            if (!args[0]) {
                // Show status
                await bot.sendMessage(m.chat, {
                    text: `*🛡️ ANTIDELETE SYSTEM*\n\n` +
                          `*Status:* ${config.enabled ? '✅ ACTIVE' : '❌ INACTIVE'}\n\n` +
                          `*Commands:*\n` +
                          `• antidelete on - Enable protection\n` +
                          `• antidelete off - Disable protection\n\n` +
                          `*Note:* Only works for bot owner`
                }, { quoted: m });
                return;
            }
            
            const action = args[0].toLowerCase();
            
            if (action === 'on') {
                config.enabled = true;
                saveAntideleteConfig(config);
                await bot.sendMessage(m.chat, {
                    text: '✅ *Anti-delete activated*\n\nNow monitoring all deleted messages. Reports will be sent to you.'
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
                    text: '⚠️ *Invalid command*\n\nUse: antidelete on/off'
                }, { quoted: m });
            }
            
        } catch (error) {
            console.log('Anti-delete command error:', error.message);
            await bot.sendMessage(m.chat, {
                text: `❌ Error: ${error.message}`
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
