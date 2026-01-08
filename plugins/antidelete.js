const fs = require('fs');
const path = require('path');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');

// Simple in-memory storage for messages
const messageStore = new Map();

// Plugin structure
module.exports = {
    name: 'antidelete',
    description: 'Track deleted messages and notify bot owner',
    category: 'utility',
    ownerOnly: true,
    
    async execute(bot, m, args) {
        try {
            // Check if anti-delete is enabled in config
            const isEnabled = global.antidelete === true;
            
            if (!args[0]) {
                // Show status
                const status = isEnabled ? '✅ ENABLED' : '❌ DISABLED';
                await bot.sendMessage(m.chat, {
                    text: `*🛡️ ANTIDELETE SYSTEM*\n\n` +
                          `Status: ${status}\n\n` +
                          `Config: ${global.antidelete !== undefined ? 'Set in config.js' : 'Not set in config.js'}\n\n` +
                          `*Commands:*\n` +
                          `• antidelete on - Enable protection\n` +
                          `• antidelete off - Disable protection\n\n` +
                          `*Note:* Reports are sent to bot owner only`
                }, { quoted: m });
                return;
            }
            
            const action = args[0].toLowerCase();
            
            if (action === 'on') {
                global.antidelete = true;
                await bot.sendMessage(m.chat, {
                    text: '✅ *Anti-delete activated*\n\nNow monitoring all deleted messages. Reports will be sent to bot owner.\n\n*Note:* Add `global.antidelete = true;` to config.js to persist setting.'
                }, { quoted: m });
            } 
            else if (action === 'off') {
                global.antidelete = false;
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
            console.log('Anti-delete command error:', error.message);
            await bot.sendMessage(m.chat, {
                text: `❌ Error: ${error.message}`
            }, { quoted: m });
        }
    },
    
    // Store incoming messages
    onMessage: async (bot, message) => {
        try {
            // Only store if anti-delete is enabled
            if (global.antidelete !== true) return;
            
            if (!message || !message.key || !message.key.id) return;
            
            const messageId = message.key.id;
            let content = '';
            let mediaType = '';
            
            // Extract message content
            const msg = message.message || {};
            
            if (msg.conversation) {
                content = msg.conversation;
            } else if (msg.extendedTextMessage?.text) {
                content = msg.extendedTextMessage.text;
            } else if (msg.imageMessage) {
                mediaType = 'image';
                content = msg.imageMessage.caption || '';
            } else if (msg.videoMessage) {
                mediaType = 'video';
                content = msg.videoMessage.caption || '';
            } else if (msg.stickerMessage) {
                mediaType = 'sticker';
            } else if (msg.audioMessage) {
                mediaType = 'audio';
            }
            
            // Get sender information
            let sender = message.key.participant || message.key.remoteJid || 'unknown';
            
            // Clean sender JID (simple extraction without jidDecode)
            if (sender.includes('@')) {
                sender = sender.split('@')[0] + '@s.whatsapp.net';
            } else if (sender.includes(':')) {
                sender = sender.split(':')[0] + '@s.whatsapp.net';
            }
            
            // Store message info
            messageStore.set(messageId, {
                content,
                mediaType,
                sender,
                isGroup: message.key.remoteJid?.endsWith('@g.us') || false,
                timestamp: Date.now()
            });
            
            // Limit store size (keep last 1000 messages)
            if (messageStore.size > 1000) {
                const oldestKey = messageStore.keys().next().value;
                messageStore.delete(oldestKey);
            }
            
        } catch (error) {
            // Silent error handling
        }
    },
    
    // Handle message deletions
    onMessageDelete: async (bot, deletionMessage) => {
        try {
            // Only process if anti-delete is enabled
            if (global.antidelete !== true) return;
            
            if (!deletionMessage || !deletionMessage.message?.protocolMessage?.key?.id) {
                return;
            }
            
            const messageId = deletionMessage.message.protocolMessage.key.id;
            const original = messageStore.get(messageId);
            
            if (!original) return;
            
            // Get who deleted the message
            let deletedBy = deletionMessage.participant || deletionMessage.key?.participant || 'unknown';
            
            // Clean deletedBy JID
            if (deletedBy.includes('@')) {
                deletedBy = deletedBy.split('@')[0];
            } else if (deletedBy.includes(':')) {
                deletedBy = deletedBy.split(':')[0];
            }
            
            // Get bot owner
            let ownerNumber = bot.user?.id || '';
            if (ownerNumber.includes(':')) {
                ownerNumber = ownerNumber.split(':')[0];
            }
            
            // Skip if bot deleted its own message
            if (deletedBy === ownerNumber) return;
            
            // Prepare report
            const sender = original.sender.split('@')[0] || original.sender;
            const time = new Date(original.timestamp).toLocaleTimeString('en-US', {
                timeZone: 'Asia/Kolkata',
                hour12: true,
                hour: '2-digit',
                minute: '2-digit'
            });
            
            let report = `*🔰 ANTIDELETE ALERT 🔰*\n\n`;
            report += `*❌ Deleted By:* ${deletedBy}\n`;
            report += `*👤 Original Sender:* ${sender}\n`;
            report += `*🕒 Time:* ${time}\n`;
            report += `*💬 Chat Type:* ${original.isGroup ? 'Group' : 'Private'}\n`;
            
            if (original.mediaType) {
                report += `*📎 Media Type:* ${original.mediaType.toUpperCase()}\n`;
            }
            
            if (original.content) {
                report += `\n*📝 Message:*\n${original.content.substring(0, 500)}`;
                if (original.content.length > 500) {
                    report += '...';
                }
                report += '\n';
            }
            
            // Send report to bot owner
            const ownerJid = ownerNumber + '@s.whatsapp.net';
            await bot.sendMessage(ownerJid, { text: report });
            
            // Clean up
            messageStore.delete(messageId);
            
        } catch (error) {
            // Silent error handling
        }
    }
};
