// lib/antidelete.js
const fs = require('fs');
const path = require('path');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const { writeFile } = require('fs/promises');

// Configuration
const CONFIG_PATH = path.join(__dirname, '../data/antidelete.json');
const TEMP_MEDIA_DIR = path.join(__dirname, '../tmp');
const MAX_STORE_SIZE = 1000;
const MESSAGE_TTL = 24 * 60 * 60 * 1000; // 24 hours

// Ensure directories exist
if (!fs.existsSync(TEMP_MEDIA_DIR)) {
    fs.mkdirSync(TEMP_MEDIA_DIR, { recursive: true });
}

if (!fs.existsSync(path.dirname(CONFIG_PATH))) {
    fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
}

// Message store
const messageStore = new Map();

// ========================
// CONFIG FUNCTIONS
// ========================
function loadAntideleteConfig() {
    try {
        if (!fs.existsSync(CONFIG_PATH)) {
            return { enabled: false, notifyOwner: true };
        }
        return JSON.parse(fs.readFileSync(CONFIG_PATH));
    } catch {
        return { enabled: false, notifyOwner: true };
    }
}

function saveAntideleteConfig(config) {
    try {
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
    } catch (err) {
        console.error('Config save error:', err);
    }
}

// ========================
// STORAGE MANAGEMENT
// ========================
function getFolderSizeInMB(folderPath) {
    try {
        const files = fs.readdirSync(folderPath);
        let totalSize = 0;

        for (const file of files) {
            const filePath = path.join(folderPath, file);
            if (fs.statSync(filePath).isFile()) {
                totalSize += fs.statSync(filePath).size;
            }
        }

        return totalSize / (1024 * 1024); // Convert bytes to MB
    } catch (err) {
        console.error('Error getting folder size:', err);
        return 0;
    }
}

function cleanTempFolderIfLarge() {
    try {
        const sizeMB = getFolderSizeInMB(TEMP_MEDIA_DIR);
        
        if (sizeMB > 100) {
            const files = fs.readdirSync(TEMP_MEDIA_DIR);
            // Delete oldest files first
            const fileStats = files.map(file => {
                const filePath = path.join(TEMP_MEDIA_DIR, file);
                return {
                    name: file,
                    path: filePath,
                    time: fs.statSync(filePath).birthtime.getTime()
                };
            }).sort((a, b) => a.time - b.time);
            
            // Delete until under 50MB
            for (const file of fileStats) {
                if (getFolderSizeInMB(TEMP_MEDIA_DIR) <= 50) break;
                try {
                    fs.unlinkSync(file.path);
                } catch (err) {
                    console.error('Failed to delete:', file.name);
                }
            }
        }
    } catch (err) {
        console.error('Temp cleanup error:', err);
    }
}

function cleanupMessageStore() {
    const now = Date.now();
    for (const [id, message] of messageStore.entries()) {
        const age = now - new Date(message.timestamp).getTime();
        if (age > MESSAGE_TTL || messageStore.size > MAX_STORE_SIZE) {
            // Clean up media files
            if (message.mediaPath && fs.existsSync(message.mediaPath)) {
                try {
                    fs.unlinkSync(message.mediaPath);
                } catch (err) {
                    console.error('Cleanup unlink error:', err);
                }
            }
            messageStore.delete(id);
        }
    }
}

// Start periodic cleanups
setInterval(cleanTempFolderIfLarge, 60 * 1000); // Every minute
setInterval(cleanupMessageStore, 60 * 60 * 1000); // Every hour

// ========================
// MESSAGE HANDLING
// ========================
async function storeMessage(message) {
    try {
        const config = loadAntideleteConfig();
        if (!config.enabled) return; // Don't store if antidelete is disabled

        if (!message.key?.id) return;

        const messageId = message.key.id;
        let content = '';
        let mediaType = '';
        let mediaPath = '';

        const sender = message.key.participant || message.key.remoteJid;

        // Detect content
        if (message.message?.conversation) {
            content = message.message.conversation;
        } else if (message.message?.extendedTextMessage?.text) {
            content = message.message.extendedTextMessage.text;
        } else if (message.message?.imageMessage) {
            mediaType = 'image';
            content = message.message.imageMessage.caption || '';
            const buffer = await downloadContentFromMessage(message.message.imageMessage, 'image');
            mediaPath = path.join(TEMP_MEDIA_DIR, `${messageId}.jpg`);
            await writeFile(mediaPath, buffer);
        } else if (message.message?.stickerMessage) {
            mediaType = 'sticker';
            const buffer = await downloadContentFromMessage(message.message.stickerMessage, 'sticker');
            mediaPath = path.join(TEMP_MEDIA_DIR, `${messageId}.webp`);
            await writeFile(mediaPath, buffer);
        } else if (message.message?.videoMessage) {
            mediaType = 'video';
            content = message.message.videoMessage.caption || '';
            const buffer = await downloadContentFromMessage(message.message.videoMessage, 'video');
            mediaPath = path.join(TEMP_MEDIA_DIR, `${messageId}.mp4`);
            await writeFile(mediaPath, buffer);
        } else if (message.message?.audioMessage) {
            mediaType = 'audio';
            const buffer = await downloadContentFromMessage(message.message.audioMessage, 'audio');
            mediaPath = path.join(TEMP_MEDIA_DIR, `${messageId}.ogg`);
            await writeFile(mediaPath, buffer);
        } else if (message.message?.documentMessage) {
            mediaType = 'document';
            content = message.message.documentMessage.fileName || '';
            const buffer = await downloadContentFromMessage(message.message.documentMessage, 'document');
            const extension = message.message.documentMessage.fileName?.split('.').pop() || 'bin';
            mediaPath = path.join(TEMP_MEDIA_DIR, `${messageId}.${extension}`);
            await writeFile(mediaPath, buffer);
        }

        messageStore.set(messageId, {
            content,
            mediaType,
            mediaPath,
            sender,
            group: message.key.remoteJid.endsWith('@g.us') ? message.key.remoteJid : null,
            timestamp: new Date().toISOString()
        });

    } catch (err) {
        console.error('storeMessage error:', err);
    }
}

// ========================
// DELETION HANDLING
// ========================
async function handleMessageRevocation(sock, revocationMessage) {
    try {
        const config = loadAntideleteConfig();
        if (!config.enabled) return;

        const messageId = revocationMessage.message.protocolMessage.key.id;
        const deletedBy = revocationMessage.participant || revocationMessage.key.participant || revocationMessage.key.remoteJid;
        const ownerNumber = sock.user.id.split(':')[0] + '@s.whatsapp.net';

        // Don't notify if bot deleted the message
        if (deletedBy.includes(sock.user.id) || deletedBy === ownerNumber) return;

        const original = messageStore.get(messageId);
        if (!original) return;

        const sender = original.sender;
        const senderName = sender.split('@')[0];
        const groupName = original.group ? (await sock.groupMetadata(original.group)).subject : '';

        const time = new Date().toLocaleString('en-US', {
            timeZone: 'Asia/Kolkata',
            hour12: true, hour: '2-digit', minute: '2-digit', second: '2-digit',
            day: '2-digit', month: '2-digit', year: 'numeric'
        });

        let text = `*🔰 ANTIDELETE REPORT 🔰*\n\n` +
            `*🗑️ Deleted By:* @${deletedBy.split('@')[0]}\n` +
            `*👤 Sender:* @${senderName}\n` +
            `*📱 Number:* ${sender}\n` +
            `*🕒 Time:* ${time}\n`;

        if (groupName) text += `*👥 Group:* ${groupName}\n`;

        if (original.content) {
            text += `\n*💬 Deleted Message:*\n${original.content}`;
        }

        // Send notification to owner
        if (config.notifyOwner !== false) {
            await sock.sendMessage(ownerNumber, {
                text,
                mentions: [deletedBy, sender]
            });

            // Send media if exists
            if (original.mediaType && fs.existsSync(original.mediaPath)) {
                const mediaOptions = {
                    caption: `*Deleted ${original.mediaType}*\nFrom: @${senderName}`,
                    mentions: [sender]
                };

                try {
                    switch (original.mediaType) {
                        case 'image':
                            await sock.sendMessage(ownerNumber, {
                                image: { url: original.mediaPath },
                                ...mediaOptions
                            });
                            break;
                        case 'sticker':
                            await sock.sendMessage(ownerNumber, {
                                sticker: { url: original.mediaPath },
                                ...mediaOptions
                            });
                            break;
                        case 'video':
                            await sock.sendMessage(ownerNumber, {
                                video: { url: original.mediaPath },
                                ...mediaOptions
                            });
                            break;
                        case 'audio':
                            await sock.sendMessage(ownerNumber, {
                                audio: { url: original.mediaPath },
                                mimetype: 'audio/ogg'
                            });
                            break;
                        case 'document':
                            await sock.sendMessage(ownerNumber, {
                                document: { url: original.mediaPath },
                                fileName: `deleted_${original.mediaType}_${messageId}`
                            });
                            break;
                    }
                } catch (err) {
                    await sock.sendMessage(ownerNumber, {
                        text: `⚠️ Error sending media: ${err.message}`
                    });
                }
            }
        }

        // Cleanup
        try {
            if (original.mediaPath && fs.existsSync(original.mediaPath)) {
                fs.unlinkSync(original.mediaPath);
            }
        } catch (err) {
            console.error('Media cleanup error:', err);
        }

        messageStore.delete(messageId);

    } catch (err) {
        console.error('handleMessageRevocation error:', err);
    }
}

// ========================
// COMMAND HANDLER
// ========================
async function handleAntideleteCommand(sock, chatId, message, match) {
    // Check if message is from bot owner
    if (!message.key?.fromMe) {
        return sock.sendMessage(chatId, { text: '*Only the bot owner can use this command.*' });
    }

    const config = loadAntideleteConfig();

    if (!match) {
        // Show status
        const status = config.enabled ? '✅ Enabled' : '❌ Disabled';
        const notifyStatus = config.notifyOwner !== false ? '✅ Enabled' : '❌ Disabled';
        
        return sock.sendMessage(chatId, {
            text: `*ANTIDELETE SETUP*\n\n` +
                  `*Current Status:* ${status}\n` +
                  `*Notify Owner:* ${notifyStatus}\n\n` +
                  `*.antidelete on* - Enable\n` +
                  `*.antidelete off* - Disable\n` +
                  `*.antidelete notify on/off* - Toggle notifications`
        });
    }

    const args = match.toLowerCase().split(' ');

    if (args[0] === 'on') {
        config.enabled = true;
        saveAntideleteConfig(config);
        return sock.sendMessage(chatId, { text: '*✅ Anti-delete enabled*\nBot will now track deleted messages.' });
    } 
    else if (args[0] === 'off') {
        config.enabled = false;
        saveAntideleteConfig(config);
        return sock.sendMessage(chatId, { text: '*❌ Anti-delete disabled*\nBot will no longer track deleted messages.' });
    }
    else if (args[0] === 'notify') {
        if (args[1] === 'on') {
            config.notifyOwner = true;
            saveAntideleteConfig(config);
            return sock.sendMessage(chatId, { text: '*✅ Notifications enabled*\nYou will receive notifications for deleted messages.' });
        } 
        else if (args[1] === 'off') {
            config.notifyOwner = false;
            saveAntideleteConfig(config);
            return sock.sendMessage(chatId, { text: '*🔕 Notifications disabled*\nYou will NOT receive notifications for deleted messages.' });
        }
    }
    else {
        return sock.sendMessage(chatId, { text: '*Invalid command. Use .antidelete to see usage.*' });
    }
}

// ========================
// EXPORTS
// ========================
module.exports = {
    loadAntideleteConfig,
    saveAntideleteConfig,
    storeMessage,
    handleMessageRevocation,
    handleAntideleteCommand,
    cleanTempFolderIfLarge,
    cleanupMessageStore
};
