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
let ownerNumber = null; // Will be auto-detected

// Check if this is a restart after auto-update
if (process.env.CYPHERS_AUTO_UPDATED === 'true') {
    console.log('\x1b[32m╔═══════════════════════════════════════════╗\x1b[0m');
    console.log('\x1b[32m║        ✅ VERIFIED UPDATE                 ║\x1b[0m');
    console.log('\x1b[32m║        Running latest version now 🔥     ║\x1b[0m');
    console.log('\x1b[32m╚═══════════════════════════════════════════╝\x1b[0m');
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
                console.log(color(`🔄 Fully loaded: ${plugin.name}`, 'cyan'));
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
            console.log(color(`✗ Failed to load ${file}: ${error.message}`, 'red'));
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
                            console.log(color(`✗ Failed to reload ${path.basename(filePath)}: ${error.message}`, 'red'));
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
        message += `🔧 *Commit:* ${shortCommit}\n`;
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
        
        // You can send to specific chats here
        // Example: await bot.sendMessage('1234567890@s.whatsapp.net', { text: message });
        
        // For now, just log it
        console.log('\x1b[36m📢 Auto-Update Notification:\x1b[0m');
        console.log(message);
        
    } catch (error) {
        console.error('Failed to send update notification:', error);
    }
}

// Helper functions
function isPrivateChat(jid) {
    return jid.endsWith('@s.whatsapp.net') || jid.endsWith('@c.us');
}

function isGroupChat(jid) {
    return jid.endsWith('@g.us');
}

// Check if sender is owner - auto-detected from session
function isOwner(sender) {
    if (!ownerNumber) return false;
    const senderNumber = sender.replace('@s.whatsapp.net', '').replace('@c.us', '');
    return senderNumber === ownerNumber;
}

// Get owner number from session
function getOwnerNumberFromSession() {
    try {
        // Check session folder
        const sessionDir = path.join(__dirname, 'session');
        if (fs.existsSync(sessionDir)) {
            const files = fs.readdirSync(sessionDir);
            for (const file of files) {
                if (file.endsWith('.json') && file.includes('creds')) {
                    try {
                        const credsPath = path.join(sessionDir, file);
                        const creds = JSON.parse(fs.readFileSync(credsPath, 'utf8'));
                        if (creds.me && creds.me.id) {
                            // Extract number from id (e.g., "628123456789@s.whatsapp.net")
                            const match = creds.me.id.match(/^(\d+)@/);
                            if (match) {
                                return match[1];
                            }
                        }
                    } catch (e) {
                        console.log(color('Error reading session file:', 'yellow'), e.message);
                    }
                }
            }
        }
        return null;
    } catch (error) {
        console.log(color('Error getting owner number:', 'yellow'), error.message);
        return null;
    }
}

// Simple cache for waiting messages to avoid spam
const waitingMessagesCache = new Map();

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
        const phoneNumber = await question('Enter bot phone number 📱😏 : Example 62xxx\n');
        const code = await cyphers.requestPairingCode(phoneNumber, "CYPHERSS");
        console.log(`\x1b[1;33mPairing Code: ${code}\x1b[0m`);
    }

    store.bind(cyphers.ev);
    
    // Auto-detect owner number
    ownerNumber = getOwnerNumberFromSession();
    if (ownerNumber) {
        console.log(color(`Owner auto-detected: ${ownerNumber}`, 'green'));
    } else if (cyphers.user && cyphers.user.id) {
        // Extract from current connection
        const match = cyphers.user.id.match(/^(\d+)@/);
        if (match) {
            ownerNumber = match[1];
            console.log(color(`Owner detected from connection: ${ownerNumber}`, 'green'));
        }
    }
    
    if (!autoUpdater) {
        console.log('\x1b[36m╔═══════════════════════════════════════════╗\x1b[0m');
        console.log('\x1b[36m║            STARTING UPDATE               ║\x1b[0m');
        console.log('\x1b[36m║      🔗 Repo: cybercyphers/cyphers-v2     ║\x1b[0m');
        console.log('\x1b[36m║      ⏱️  fully loaded                     ║\x1b[0m');
        console.log('\x1b[36m╚═══════════════════════════════════════════╝\x1b[0m');
        
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
    
    // Setup hot reload
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
            
            const chatJid = mek.key.remoteJid;
            const senderJid = mek.key.participant || mek.key.remoteJid;
            const isPrivate = isPrivateChat(chatJid);
            const isGroup = isGroupChat(chatJid);
            
            // Process messages normally regardless of public/private mode
            // We'll handle the mode check later in command processing
            
            if (mek.key.id.startsWith('BAE5') && mek.key.id.length === 16) return;
            if (mek.key.id.startsWith('FatihArridho_')) return;
            
            const m = smsg(cyphers, mek, store);
            const messageText = m.body?.toLowerCase() || '';
            const prefix = global.prefix || '.';
            
            // Check if message is a command
            const isCommand = messageText.startsWith(prefix);
            
            // If in private mode and not from owner, show waiting message for non-commands
            if (!cyphers.public && !isOwner(senderJid) && isPrivate && !isCommand) {
                // Only show waiting message for regular messages (not commands)
                const cacheKey = `waiting_${chatJid}`;
                const lastMessageTime = waitingMessagesCache.get(cacheKey) || 0;
                
                // Only send message if last one was more than 1 minute ago
                if (Date.now() - lastMessageTime > 60000) {
                    const waitingMsg = "⏳ *Waiting for messages...*\n\n" +
                                      "I'm currently in private mode.\n" +
                                      "Only the bot owner can use commands.\n" +
                                      "Please contact the owner for access.";
                    
                    await cyphers.sendMessage(chatJid, { text: waitingMsg });
                    waitingMessagesCache.set(cacheKey, Date.now());
                }
                return; // Don't process regular messages from non-owners in private mode
            }
            
            // Slow response check for groups
            if (isGroup) {
                // Add small delay for group messages to prevent flood
                await sleep(500);
            }
            
            if (isCommand) {
                // Add extra delay for groups if command is heavy
                if (isGroup) {
                    const heavyCommands = ['image', 'video', 'sticker', 'download'];
                    const commandName = messageText.slice(prefix.length).trim().split(/ +/)[0];
                    if (heavyCommands.includes(commandName)) {
                        await sleep(1000); // Extra delay for media commands
                    }
                }
                
                const args = messageText.slice(prefix.length).trim().split(/ +/);
                const commandName = args.shift().toLowerCase();
                const quoted = m.quoted || null;
                
                // Check if bot is in private mode and command is not from owner
                if (!cyphers.public && !isOwner(senderJid)) {
                    // In private mode, only owner can use commands
                    await cyphers.sendMessage(m.chat, { 
                        text: "🔒 *Private Mode*\n\n" +
                              "I'm currently in private mode.\n" +
                              "Only the bot owner can use commands.\n" +
                              "Please contact the owner for access."
                    }, { quoted: m });
                    return;
                }
                
                // Get latest plugins
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
                    // Show limited command list in groups to keep it fast
                    let commandList = Object.values(plugins);
                    
                    // Filter for groups to show only essential commands
                    if (isGroup) {
                        commandList = commandList.slice(0, 5); // Show only first 5
                    }
                    
                    const commandText = commandList
                        .map(p => `${prefix}${p.name} - ${p.description || ''}`)
                        .join('\n');
                    
                    await cyphers.sendMessage(m.chat, { 
                        text: `❓ Command not found!\n\n📋 ${isGroup ? 'Quick ' : ''}Commands:\n${commandText || 'No commands loaded'}\n\n${isGroup ? 'Type .help for full list' : ''}` 
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
    
    global.idch1  = "120363398394780625@newsletter"
    global.idch2  = "120363400516938325@newsletter"
    global.idch3  = "120363403227392831@newsletter"
    global.idch4  = "120363417615958545@newsletter"
    global.idch5  = "120363417875556388@newsletter"
    global.idch6  = "120363347147058928@newsletter"
    global.idch7  = "120363400726940142@newsletter"
    global.idch8  = "120363399790421982@newsletter"
    global.idch9  = "120363418229648144@newsletter"
    global.idch10 = "120363421353456297@newsletter"
    global.idch11 = "120363420472611595@newsletter"
    global.idch12 = "120363403578572630@newsletter"
    global.idch13 = "120363418736784979@newsletter"

    // Set public/private mode (can be controlled from config)
    cyphers.public = global.status !== undefined ? global.status : true;
    
    if (!cyphers.public) {
        console.log(color('Mode: PRIVATE (Only owner can use commands)', 'yellow'));
    } else {
        console.log(color('Mode: PUBLIC (Everyone can use commands)', 'green'));
    }

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
            const channels = [
                global.idch1, global.idch2, global.idch3, global.idch4, global.idch5,
                global.idch6, global.idch7, global.idch8, global.idch9, global.idch10,
                global.idch11, global.idch12, global.idch13
            ];
            
            for (const channel of channels) {
                try {
                    await cyphers.newsletterFollow(channel);
                } catch (error) {
                    console.log(color(`Failed ${channel}: ${error.message}`, 'yellow'));
                }
            }
            
            console.log('\x1b[32m╔═══════════════════════════════════════════╗\x1b[0m');
            console.log('\x1b[32m║             ✅ CYPHERS-V2 Active 😊     ║\x1b[0m');
            console.log(`\x1b[32m║     📦 ${Object.keys(plugins).length} plugins loaded      ║\x1b[0m`);
            console.log(`\x1b[32m║     🚀 Mode: ${cyphers.public ? 'Public' : 'Private'.padEnd(22)} ║\x1b[0m`);
            console.log('\x1b[32m║     🔄 Auto-updater: Active            ║\x1b[0m');
            if (ownerNumber) {
                console.log(`\x1b[32m║     👑 Owner: ${ownerNumber.padEnd(29)} ║\x1b[0m`);

            }
            console            }
            console.log('\x1.log('\x1b[32m╚════════════════b[32m╚══════════════════════════════════════════════════════════════════════╝╝\x1b[0\x1b[0m');
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
    returnm');
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
    return cyp cyphers;
}

// Start the bot
cyphersStart().catchhers;
}

// Start the bot
cyphersStart().catch(error => {
    console.error(color('(error => {
    console.errorFailed to start bot:', 'red'),(color('Failed to start bot:', 'red'), error);
    process.exit( error);
    process.exit(1);
});

// Watch main file for1);
});

// Watch main changes
let file = require.resolve(__ file for changes
let file = require.resolve(__filename);
fs.watchFilefilename);
fs.watchFile(file, () => {
    fs.un(file, () => {
    fswatchFile(file);
    console.log('\.unwatchFile(file);
    console.log('\x1b[0;x1b[0;32m32m' +' + __filename + ' \x1b[1;32 __filename + ' \x1b[1;32mupdated!\x1bmupdated!\x1b[0[0m');
    delete require.cm');
    delete require.cache[file];
    require(file);
ache[file];
    require(file);
});
