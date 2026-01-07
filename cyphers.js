console.clear();
console.log('Starting...');
require('./settings/config');

// ============================
// AUTO-UPDATER IMPORT
// ============================
const AutoUpdater = require('./deadline');

const { 
    default: makeWASocket, 
    prepareWAMessageMedia, 
    useMultiFileAuthState, 
    DisconnectReason, 
    fetchLatestBaileysVersion, 
    makeInMemoryStore, 
    generateWAMessageFromContent, 
    generateWAMessageContent, 
    jidDecode, 
    proto, 
    relayWAMessage, 
    getContentType, 
    getAggregateVotesInPollMessage, 
    downloadContentFromMessage, 
    fetchLatestWaWebVersion, 
    InteractiveMessage, 
    makeCacheableSignalKeyStore, 
    Browsers, 
    generateForwardMessageContent, 
    MessageRetryMap 
} = require("@whiskeysockets/baileys");

const pino = require('pino');
const readline = require("readline");
const fs = require('fs');
const path = require('path');
const { Boom } = require('@hapi/boom');
const { color } = require('./lib/color');
const { smsg, sendGmail, formatSize, isUrl, generateMessageTag, getBuffer, getSizeMedia, runtime, fetchJson, sleep } = require('./lib/myfunction');

const usePairingCode = true;
const question = (text) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise((resolve) => { rl.question(text, resolve) });
}

const store = makeInMemoryStore({ logger: pino().child({ level: 'silent', stream: 'store' }) });

// Global variables
let plugins = {};
let pluginWatchers = {};
let loadedPlugins = new Set();
let autoUpdater = null;
let cyphersInstance = null;

// Check if this is a restart after auto-update
if (process.env.CYPHERS_AUTO_UPDATED === 'true') {
    console.log('\x1b[32m┌──────────────────────────────────────────────────────────┐\x1b[0m');
    console.log('\x1b[32m│        ✅ VERIFIED UPDATE                              │\x1b[0m');
    console.log('\x1b[32m│        Running latest version now ⚡  seriously                  │\x1b[0m');
    console.log('\x1b[32m└──────────────────────────────────────────────────────────┘\x1b[0m');
    delete process.env.CYPHERS_AUTO_UPDATED;
}

// Enhanced plugin loader with hot reload
function loadPlugins(reload = false) {
    const pluginsDir = path.join(__dirname, 'plugins');
    
    if (!fs.existsSync(pluginsDir)) {
        console.log(color('Plugins directory not found, creating...', 'yellow'));
        fs.mkdirSync(pluginsDir, { recursive: true });
        return;
    }
    
    const pluginFiles = fs.readdirSync(pluginsDir).filter(file => 
        file.endsWith('.js') || file.endsWith('.cjs')
    );
    
    if (!reload) {
        plugins = {};
        loadedPlugins.clear();
    }
    
    for (const file of pluginFiles) {
        try {
            const pluginPath = path.join(pluginsDir, file);
            
            // Clear cache for hot reload
            if (reload) {
                delete require.cache[require.resolve(pluginPath)];
            }
            
            const plugin = require(pluginPath);
            
            if (!plugin.name || !plugin.execute) {
                console.log(color(`✗ Invalid plugin structure in ${file}`, 'red'));
                continue;
            }
            
            plugins[plugin.name] = plugin;
            
            if (!loadedPlugins.has(plugin.name)) {
                console.log(color(`✓ Plugin loaded: ${plugin.name}`, 'green'));
                loadedPlugins.add(plugin.name);
            } else if (reload) {
                console.log(color(`🔄 Fully reloaded: ${plugin.name}`, 'cyan'));
            }
            
            // Set up file watcher for hot reload (only if not already watching)
            if (!pluginWatchers[pluginPath]) {
                pluginWatchers[pluginPath] = fs.watch(pluginPath, (eventType) => {
                    if (eventType === 'change') {
                        console.log(color(`🔄 ${file} changed, reloading....`, 'yellow'));
                        // Immediate reload without delay
                        try {
                            delete require.cache[require.resolve(pluginPath)];
                            const updatedPlugin = require(pluginPath);
                            
                            if (updatedPlugin.name && updatedPlugin.execute) {
                                plugins[updatedPlugin.name] = updatedPlugin;
                                console.log(color(`✅ ${updatedPlugin.name} reloaded successfully`, 'green'));
                            }
                        } catch (error) {
                            console.log(color(`✗ Failed to reload ${file}: ${error.message}`, 'red'));
                        }
                    }
                });
            }
            
        } catch (error) {
            console.log(color(`✗ Failed to load ${file}: ${error.message}`, 'red'));
        }
    }
}

// Enhanced hot reload for config and all library files
function setupHotReload() {
    const directoriesToWatch = [
        path.join(__dirname, './settings'),
        path.join(__dirname, './lib'),
        path.join(__dirname, './plugins')
    ];
    
    const fileWatchers = new Map();
    
    function watchDirectory(dirPath) {
        if (!fs.existsSync(dirPath)) return;
        
        // Watch for new files
        fs.watch(dirPath, { recursive: true }, (eventType, filename) => {
            if (!filename) return;
            
            const fullPath = path.join(dirPath, filename);
            
            // Only handle JavaScript files
            if (!filename.endsWith('.js') && !filename.endsWith('.cjs')) return;
            
            if (eventType === 'change') {
                // File changed - reload immediately
                setTimeout(() => {
                    try {
                        delete require.cache[require.resolve(fullPath)];
                        require(fullPath);
                        console.log(color(`✅ ${filename} reloaded `, 'green'));
                        
                        // If it's a plugin, update plugins list
                        if (dirPath.includes('plugins')) {
                            loadPlugins(true);
                        }
                    } catch (error) {
                        console.log(color(`✗ Failed to reload ${filename}: ${error.message}`, 'red'));
                    }
                }, 50);
            } else if (eventType === 'rename') {
                // File added or removed
                setTimeout(() => {
                    if (fs.existsSync(fullPath)) {
                        // New file added
                        console.log(color(`📁 New file detected: ${filename}`, 'cyan'));
                        if (dirPath.includes('plugins')) {
                            loadPlugins(true);
                        } else {
                            try {
                                require(fullPath);
                                console.log(color(`✅ ${filename} loaded`, 'green'));
                            } catch (error) {
                                console.log(color(`✗ Failed to load ${filename}: ${error.message}`, 'red'));
                            }
                        }
                    } else {
                        // File removed
                        console.log(color(`🗑️ File removed: ${filename}`, 'yellow'));
                        if (dirPath.includes('plugins')) {
                            loadPlugins(true);
                        }
                    }
                }, 100);
            }
        });
    }
    
    // Watch all directories
    directoriesToWatch.forEach(dir => watchDirectory(dir));
    
    // Also watch config.js specifically for immediate changes
    const configPath = path.join(__dirname, './settings/config.js');
    if (fs.existsSync(configPath)) {
        fs.watch(configPath, (eventType) => {
            if (eventType === 'change') {
                console.log(color('🔄 config.js changed, reloading.....', 'yellow'));
                setTimeout(() => {
                    try {
                        delete require.cache[require.resolve(configPath)];
                        require(configPath);
                        console.log(color('✅ config.js reloaded successfully', 'green'));
                        
                        // Update global variables from config
                        if (global.prefix) {
                            console.log(color(`🔄 Prefix updated to: ${global.prefix}`, 'cyan'));
                        }
                        if (global.status !== undefined) {
                            if (cyphersInstance) {
                                cyphersInstance.public = global.status || false;
                                console.log(color(`🔄 Bot mode updated: ${cyphersInstance.public ? 'Public' : 'Private'}`, 'cyan'));
                            }
                        }
                    } catch (error) {
                        console.log(color(`✗ Failed to reload config.js: ${error.message}`, 'red'));
                    }
                }, 50);
            }
        });
    }
    
    console.log(color('🔥 Hot reload enabled for all files', 'green'));
}

// Function to send update notifications to users
async function sendUpdateNotification(bot, changes, commitHash) {
    try {
        // Create update message
        const date = new Date().toLocaleString();
        const updateCount = changes.length;
        const shortCommit = commitHash.substring(0, 8);
        
        let message = `🚀 *CYPHERS-v2 UPDATED!*\n\n`;
        message += `📅 *Time:* ${date}\n`;
        message += `⚡ *Commit:* ${shortCommit}\n`;
        message += `📊 *Files Updated:* ${updateCount}\n\n`;
        
        if (changes.length > 0) {
            message += `📝 *Recent Changes:*\n`;
            changes.slice(0, 5).forEach(change => {
                const filename = change.file.length > 30 ? '...' + change.file.slice(-27) : change.file;
                message += `• ${filename} (${change.type})\n`;
            });
            
            if (changes.length > 5) {
                message += `... and ${changes.length - 5} more files\n`;
            }
        }
        
        message += `\n⚡ *What's New:*\n`;
        message += `• Bug fixes and improvements\n`;
        message += `• Performance enhancements\n`;
        message += `• New features added\n\n`;
        message += `✅ *Status:* Running latest version\n`;
        message += `🔄 Automated update by cybercyphers`;
        
        // You can send to specific chats here
        // Example: await bot.sendMessage('1234567890@s.whatsapp.net', { text: message });
        
        // For now, just log it
        console.log('\x1b[36m📢 Auto-Update :\x1b[0m');
        console.log(message);
        
    } catch (error) {
        console.error('Failed to send update notification:', error);
    }
}

async function cyphersStart() {
    const {
        state,
        saveCreds
    } = await useMultiFileAuthState("session")
    const cyphers = makeWASocket({
        printQRInTerminal: !usePairingCode,
        syncFullHistory: false,
        markOnlineOnConnect: false,
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 0,
        keepAliveIntervalMs: 10000,
        generateHighQualityLinkPreview: true,
        patchMessageBeforeSending: (message) => {
            const requiresPatch = !!(
                message.buttonsMessage ||
                message.templateMessage ||
                message.listMessage
            );
            if (requiresPatch) {
                message = {
                    viewOnceMessage: {
                        message: {
                            messageContextInfo: {
                                deviceListMetadataVersion: 2,
                                deviceListMetadata: {},
                            },
                            ...message,
                        },
                    },
                };
            }

            return message;
        },
        version: (await (await fetch('https://raw.githubusercontent.com/WhiskeySockets/Baileys/master/src/Defaults/baileys-version.json')).json()).version,
        browser: ["Ubuntu", "Chrome", "20.0.04"],
        logger: pino({
            level: 'fatal'
        }),
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino().child({
                level: 'silent',
                stream: 'store'
            })),
        }
    });

    cyphersInstance = cyphers;

    if (usePairingCode && !cyphers.authState.creds.registered) {
        const phoneNumber = await question('Enter bot phone number 🥲 : Example 62xxx\n');
        const code = await cyphers.requestPairingCode(phoneNumber, "CYPHERSS");
        console.log(`\x1b[1;33mPairing Code: ${code}\x1b[0m`);
    }

    store.bind(cyphers.ev);
    
    if (!autoUpdater) {
        console.log('\x1b[36m┌──────────────────────────────────────────────────────────┐\x1b[0m');
        console.log('\x1b[36m│            STARTING UPDATE                              │\x1b[0m');
        console.log('\x1b[36m│      ⬇ Repo: cybercyphers/cyphers-v2                   │\x1b[0m');
        console.log('\x1b[36m│      ✅ Auto-updater: Enabled                           │\x1b[0m');
        console.log('\x1b[36m└──────────────────────────────────────────────────────────┘\x1b[0m');
        
        autoUpdater = new AutoUpdater(cyphers);
        
        // Custom event handler for update notifications
        autoUpdater.onUpdateComplete = async (changes, commitHash) => {
            console.log(color('✅ Auto-update completed successfully!', 'green'));
            await sendUpdateNotification(cyphers, changes, commitHash);
        };
        
        autoUpdater.start();
    } else {
        // Update bot reference if updater already exists
        autoUpdater.bot = cyphers;
    }
    
    // Setup enhanced hot reload
    loadPlugins();
    setupHotReload();
    
    cyphers.ev.on("messages.upsert", async (chatUpdate) => {
        try {
            const mek = chatUpdate.messages[0];
            if (!mek.message) return;
            
            mek.message = (Object.keys(mek.message)[0] === 'ephemeralMessage') 
                ? mek.message.ephemeralMessage.message 
                : mek.message;
            
            if (mek.key && mek.key.remoteJid === 'status@broadcast') return;
            
            if (!cyphers.public && !mek.key.fromMe && chatUpdate.type === 'notify') return;
            
            if (mek.key.id.startsWith('BAE5') && mek.key.id.length === 16) return;
            if (mek.key.id.startsWith('FatihArridho_')) return;
            
            const m = smsg(cyphers, mek, store);
            
            const messageText = m.body?.toLowerCase() || '';
            const prefix = global.prefix || '.';
            
            if (messageText.startsWith(prefix)) {
                const args = messageText.slice(prefix.length).trim().split(/ +/);
                const commandName = args.shift().toLowerCase();
                const quoted = m.quoted || null;
                
                // Get latest plugins (always fresh due to hot reload)
                const plugin = Object.values(plugins).find(p => 
                    p.name.toLowerCase() === commandName
                );
                
                if (plugin) {
                    try {
                        const msgObj = {
                            key: {
                                remoteJid: m.chat,
                                fromMe: m.key?.fromMe || false,
                                id: m.id,
                                participant: m.sender
                            },
                            message: m.message,
                            pushName: m.pushName,
                            timestamp: m.timestamp,
                            sender: m.sender,
                            body: m.body,
                            quoted: quoted
                        };
                        
                        await plugin.execute(cyphers, msgObj, args);
                        
                    } catch (error) {
                        console.log(color(`Error in ${plugin.name}: ${error.message}`, 'red'));
                        await cyphers.sendMessage(m.chat, { 
                            text: `❌ Error: ${error.message}` 
                        }, { quoted: m });
                    }
                } else {
                    const commandList = Object.values(plugins)
                        .map(p => `${prefix}${p.name} - ${p.description || ''}`)
                        .join('\n');
                    
                    await cyphers.sendMessage(m.chat, { 
                        text: `📋 Command not found!\n\n📚 Available Commands:\n${commandList || 'No commands loaded'}` 
                    }, { quoted: m });
                }
            }
        } catch (err) {
            console.log(color(`Message error: ${err}`, 'red'));
        }
    });

    cyphers.decodeJid = (jid) => {
        if (!jid) return jid;
        if (/:\d+@/gi.test(jid)) {
            let decode = jidDecode(jid) || {};
            return decode.user && decode.server && decode.user + '@' + decode.server || jid;
        } else return jid;
    };

    cyphers.ev.on('contacts.update', update => {
        for (let contact of update) {
            let id = cyphers.decodeJid(contact.id);
            if (store && store.contacts) store.contacts[id] = { id, name: contact.notify };
        }
    });
    
    // Channel IDs (Your two channels only)
    global.idch1  = "https://whatsapp.com/channel/0029Vb7KKdB8V0toQKtI3n2j"
    global.idch2  = "https://whatsapp.com/channel/0029VbBjA7047XeKSb012y3j"

    cyphers.public = global.status || true;

    cyphers.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const reason = new Boom(lastDisconnect?.error)?.output.statusCode;
            console.log(color(lastDisconnect.error, 'deeppink'));
            if (lastDisconnect.error == '') {
                process.exit();
            } else if (reason === DisconnectReason.badSession) {
                console.log(color(`Bad Session, delete session and scan again`));
                process.exit();
            } else if (reason === DisconnectReason.connectionClosed) {
                console.log(color('Connection closed, reconnecting...', 'deeppink'));
                process.exit();
            } else if (reason === DisconnectReason.connectionLost) {
                console.log(color('Connection lost, reconnecting', 'deeppink'));
                process.exit();
            } else if (reason === DisconnectReason.connectionReplaced) {
                console.log(color('Connection replaced, close current session first'));
                cyphers.logout();
            } else if (reason === DisconnectReason.loggedOut) {
                console.log(color(`Logged out, scan again`));
                cyphers.logout();
            } else if (reason === DisconnectReason.restartRequired) {
                console.log(color('Restart required...'));
                await cyphersStart();
            } else if (reason === DisconnectReason.timedOut) {
                console.log(color('Timed out, reconnecting...'));
                cyphersStart();
            }
        } else if (connection === "connecting") {
            console.log(color('Connecting...'));
        } else if (connection === "open") {
            // Only subscribe to your two channels
            try {
                await cyphers.newsletterFollow("https://whatsapp.com/channel/0029Vb7KKdB8V0toQKtI3n2j");
                console.log(color(`✅ hello world`, 'green'));
            } catch (error) {
                console.log(color(`✗ Failed Channel 1: ${error.message}`, 'yellow'));
            }
            
            try {
                await cyphers.newsletterFollow("https://whatsapp.com/channel/0029VbBjA7047XeKSb012y3j");
                console.log(color(`✅ hello world`, 'green'));
            } catch (error) {
                console.log(color(`✗ Failed Channel 2: ${error.message}`, 'yellow'));
            }
            
            console.log('\x1b[32m┌──────────────────────────────────────────────────────────┐\x1b[0m');
            console.log('\x1b[32m│             ✅ CYPHERS-V2 Active 😊                     │\x1b[0m');
            console.log(`\x1b[32m│     📦 ${Object.keys(plugins).length} plugins loaded      │\x1b[0m`);
            console.log('\x1b[32m│     🚀 Auto-update: Active                            │\x1b[0m');
            console.log('\x1b[32m│     🔥 Hot reload: Enabled                             │\x1b[0m');
            console.log('\x1b[32m│      ⬇️   Full downlaod no delay                      │\x1b[0m');
            console.log('\x1b[32m└──────────────────────────────────────────────────────────┘\x1b[0m');
        }
    });

    cyphers.sendText = (jid, text, quoted = '', options) => 
        cyphers.sendMessage(jid, { text: text, ...options }, { quoted });
    
    cyphers.downloadMediaMessage = async (message) => {
        let mime = (message.msg || message).mimetype || '';
        let messageType = message.mtype ? message.mtype.replace(/Message/gi, '') : mime.split('/')[0];
        const stream = await downloadContentFromMessage(message, messageType);
        let buffer = Buffer.from([]);
        for await(const chunk of stream) {
            buffer = Buffer.concat([buffer, chunk]);
        }
        return buffer;
    };
    
    cyphers.ev.on('creds.update', saveCreds);
    return cyphers;
}

// Start the bot
cyphersStart().catch(error => {
    console.error(color('Failed to start bot:', 'red'), error);
    process.exit(1);
});

// Watch main file for changes
let file = require.resolve(__filename);
fs.watchFile(file, () => {
    fs.unwatchFile(file);
    console.log('\x1b[0;32m' + __filename + ' \x1b[1;32mupdated!\x1b[0m');
    delete require.cache[file];
    require(file);
});
