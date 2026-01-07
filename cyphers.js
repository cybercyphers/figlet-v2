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
    console.log('\x1b[32m═══════════════════════════════════════════════════════════════\x1b[0m');
    console.log('\x1b[32m║        ✅ VERIFIED UPDATE     ║\x1b[0m');
    console.log('\x1b[32m║        Running latest version now ⚡       ║\x1b[0m');
    console.log('\x1b[32m═══════════════════════════════════════════════════════════════\x1b[0m');
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
                console.log(color(`❌ Invalid plugin structure in ${file}`, 'red'));
                continue;
            }
            
            plugins[plugin.name] = plugin;
            
            if (!loadedPlugins.has(plugin.name)) {
                console.log(color(`✅ Plugin loaded: ${plugin.name}`, 'green'));
                loadedPlugins.add(plugin.name);
            } else if (reload) {
                console.log(color(`🔄 Reloaded: ${plugin.name}`, 'cyan'));
            }
            
            // Set up file watcher for hot reload
            if (!pluginWatchers[file]) {
                pluginWatchers[file] = fs.watch(pluginPath, (eventType) => {
                    if (eventType === 'change') {
                        setTimeout(() => {
                            console.log(color(`🔄 ${file} changed, reloading...`, 'yellow'));
                            loadPlugins(true);
                        }, 100);
                    }
                });
            }
            
        } catch (error) {
            console.log(color(`❌ Failed to load ${file}: ${error.message}`, 'red'));
        }
    }
}

// Hot reload for config and lib files
function setupHotReload() {
    const filesToWatch = [
        path.join(__dirname, './settings/config.js'),
        path.join(__dirname, './lib/color.js'),
        path.join(__dirname, './lib/myfunction.js')
    ];
    
    filesToWatch.forEach(filePath => {
        if (fs.existsSync(filePath)) {
            fs.watch(filePath, (eventType) => {
                if (eventType === 'change') {
                    setTimeout(() => {
                        console.log(color(`🔄 ${path.basename(filePath)} changed, reloading...`, 'yellow'));
                        
                        // Clear require cache
                        delete require.cache[require.resolve(filePath)];
                        
                        // Reload the file
                        try {
                            require(filePath);
                            console.log(color(`✅ ${path.basename(filePath)} reloaded`, 'green'));
                        } catch (error) {
                            console.log(color(`❌ Failed to reload ${path.basename(filePath)}: ${error.message}`, 'red'));
                        }
                    }, 100);
                }
            });
        }
    });
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
        message += `🔗 *Commit:* ${shortCommit}\n`;
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
        message += `🔄 Automated and by cybercyphers`;
        
        console.log('\x1b[36m📢 Auto-Update Notification:\x1b[0m');
        console.log(message);
        
    } catch (error) {
        console.error('Failed to send update notification:', error);
    }
}

// Create a plugin wrapper to fix quoting in plugins
function createPluginWrapper(plugin, originalMessage) {
    return {
        ...plugin,
        execute: async function(bot, msg, args) {
            try {
                // Create a modified bot object for this execution
                const modifiedBot = Object.create(bot);
                
                // Override sendMessage to handle quoting properly
                const originalSendMessage = bot.sendMessage;
                modifiedBot.sendMessage = async function(jid, content, options = {}) {
                    const isGroup = jid.endsWith('@g.us');
                    
                    // Remove quoted option in DMs
                    if (!isGroup && options.quoted) {
                        delete options.quoted;
                    }
                    
                    return originalSendMessage.call(this, jid, content, options);
                };
                
                // Add safeReply method
                modifiedBot.safeReply = async (text, replyTo = null) => {
                    const isGroup = msg.chat.endsWith('@g.us');
                    const options = (isGroup && replyTo) ? { quoted: replyTo } : {};
                    return modifiedBot.sendMessage(msg.chat, { text }, options);
                };
                
                // Execute the original plugin
                return await plugin.execute.call(this, modifiedBot, msg, args);
            } catch (error) {
                throw error;
            }
        }
    };
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
		browser: Browsers.ubuntu("Chrome"), // FIXED: Use proper browser format
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
        const phoneNumber = await question('Enter bot phone number 📱😏 : Example 62xxx\n');
        const code = await cyphers.requestPairingCode(phoneNumber, "CYPHERSS");
        console.log(`\x1b[1;33mPairing Code: ${code}\x1b[0m`);
    }

    store.bind(cyphers.ev);
    
    if (!autoUpdater) {
        console.log('\x1b[36m═══════════════════════════════════════════════════════════════\x1b[0m');
        console.log('\x1b[36m║            STARTING UPDATE      ║\x1b[0m');
        console.log('\x1b[36m║      ⬇ Repo: cybercyphers/cyphers-v2     ║\x1b[0m');
        console.log('\x1b[36m║      ⚡  fully loaded             ║\x1b[0m');
        console.log('\x1b[36m═══════════════════════════════════════════════════════════════\x1b[0m');
        
        autoUpdater = new AutoUpdater(cyphers);
        
        autoUpdater.onUpdateComplete = async (changes, commitHash) => {
            console.log(color('✅ Auto-update completed successfully!', 'green'));
            await sendUpdateNotification(cyphers, changes, commitHash);
        };
        
        autoUpdater.start();
    } else {
        autoUpdater.bot = cyphers;
    }
    
    // Setup hot reload
    loadPlugins();
    setupHotReload();
    
    // Message handler - COMPLETELY REWRITTEN
    cyphers.ev.on("messages.upsert", async (chatUpdate) => {
        try {
            const mek = chatUpdate.messages[0];
            if (!mek.message) return;
            
            mek.message = (Object.keys(mek.message)[0] === 'ephemeralMessage') 
                ? mek.message.ephemeralMessage.message 
                : mek.message;
            
            // Skip status updates
            if (mek.key && mek.key.remoteJid === 'status@broadcast') return;
            
            // Skip if not public and message is not from me
            if (!cyphers.public && !mek.key.fromMe && chatUpdate.type === 'notify') return;
            
            // Skip certain message IDs
            if (mek.key.id.startsWith('BAE5') && mek.key.id.length === 16) return;
            if (mek.key.id.startsWith('FatihArridho_')) return;
            
            const m = smsg(cyphers, mek, store);
            
            const messageText = m.body?.toLowerCase() || '';
            const prefix = global.prefix || '.';
            
            if (messageText.startsWith(prefix)) {
                const args = messageText.slice(prefix.length).trim().split(/ +/);
                const commandName = args.shift().toLowerCase();
                const quoted = m.quoted || null;
                
                // Get plugin
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
                        
                        // Use wrapped plugin
                        const wrappedPlugin = createPluginWrapper(plugin, m);
                        await wrappedPlugin.execute(cyphers, msgObj, args);
                        
                    } catch (error) {
                        console.log(color(`Error in ${plugin.name}: ${error.message}`, 'red'));
                        
                        // Send error WITHOUT quoting in DMs
                        const isGroup = m.chat.endsWith('@g.us');
                        await cyphers.sendMessage(m.chat, { 
                            text: `❌ Error: ${error.message}` 
                        }, isGroup ? { quoted: m } : {});
                    }
                } else {
                    const commandList = Object.values(plugins)
                        .map(p => `${prefix}${p.name} - ${p.description || ''}`)
                        .join('\n');
                    
                    // Send without quoting in DMs
                    const isGroup = m.chat.endsWith('@g.us');
                    await cyphers.sendMessage(m.chat, { 
                        text: `📋 Command not found!\n\n📚 Available Commands:\n${commandList || 'No commands loaded'}` 
                    }, isGroup ? { quoted: m } : {});
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
    
    // Your channel
    global.idch1  = "0029Vb7KKdB8V0toQKtI3n2j@newsletter";

    cyphers.public = global.status || true;

    cyphers.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        
        if (connection === 'close') {
            const reason = new Boom(lastDisconnect?.error)?.output.statusCode;
            console.log(color('Connection closed:', 'red'), lastDisconnect.error);
            
            if (reason === DisconnectReason.badSession) {
                console.log(color('Bad Session, delete session and scan again', 'yellow'));
                process.exit();
            } else if (reason === DisconnectReason.connectionClosed) {
                console.log(color('Connection closed, reconnecting...', 'yellow'));
                cyphersStart();
            } else if (reason === DisconnectReason.connectionLost) {
                console.log(color('Connection lost, reconnecting', 'yellow'));
                cyphersStart();
            } else if (reason === DisconnectReason.connectionReplaced) {
                console.log(color('Connection replaced, close current session first'));
                cyphers.logout();
            } else if (reason === DisconnectReason.loggedOut) {
                console.log(color('Logged out, scan again'));
                cyphers.logout();
            } else if (reason === DisconnectReason.restartRequired) {
                console.log(color('Restart required...'));
                await cyphersStart();
            } else if (reason === DisconnectReason.timedOut) {
                console.log(color('Timed out, reconnecting...'));
                cyphersStart();
            } else {
                cyphersStart();
            }
            
        } else if (connection === "connecting") {
            console.log(color('Connecting...', 'yellow'));
            
        } else if (connection === "open") {
            console.log('\x1b[32m═══════════════════════════════════════════════════════════════\x1b[0m');
            console.log('\x1b[32m║             ✅ CYPHERS-V2 Active 😊         ║\x1b[0m');
            console.log(`\x1b[32m║     📦 ${Object.keys(plugins).length} plugins loaded      ║\x1b[0m`);
            console.log('\x1b[32m║     🚀 Auto-updater: Active              ║\x1b[0m');
            console.log('\x1b[32m═══════════════════════════════════════════════════════════════\x1b[0m');
            
            // Try to follow channel if exists
            if (global.idch1) {
                try {
                    await cyphers.newsletterFollow(global.idch1);
                    console.log(color(`✅ Following channel: ${global.idch1}`, 'green'));
                } catch (error) {
                    console.log(color(`⚠️ Could not follow channel: ${error.message}`, 'yellow'));
                }
            }
        }
    });

    // Helper methods
    cyphers.sendText = (jid, text, quoted = '', options) => {
        const isGroup = jid.endsWith('@g.us');
        const sendOptions = { ...options };
        
        // Only add quoted if it's a group
        if (isGroup && quoted) {
            sendOptions.quoted = quoted;
        }
        
        return cyphers.sendMessage(jid, { text, ...sendOptions });
    };
    
    cyphers.reply = async (jid, text, quotedMsg, options = {}) => {
        const isGroup = jid.endsWith('@g.us');
        const finalOptions = { ...options };
        
        if (isGroup && quotedMsg) {
            finalOptions.quoted = quotedMsg;
        }
        
        return cyphers.sendMessage(jid, { text }, finalOptions);
    };
    
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
