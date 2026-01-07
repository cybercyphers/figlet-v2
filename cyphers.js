console.clear();
console.log('Starting...');
require('./settings/config');

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

// Global variables for hot reload
let plugins = {};
let pluginWatchers = {};
let loadedPlugins = new Set();

// Track first-time users
const firstTimeUsers = new Map();

// Function to get phone number from JID
function getPhoneFromJid(jid) {
    if (!jid) return null;
    const parts = jid.split('@');
    if (parts[0].includes(':')) {
        return parts[0].split(':')[0];
    }
    return parts[0];
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
                console.log(color(`🔄 Plugin reloaded: ${plugin.name}`, 'cyan'));
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

    if (usePairingCode && !cyphers.authState.creds.registered) {
        const phoneNumber = await question('Enter bot phone number 📱😏 : Example 62xxx\n');
        const code = await cyphers.requestPairingCode(phoneNumber, "CYPHERS");
        console.log(`\x1b[1;33mPairing Code: ${code}\x1b[0m`);
    }

    store.bind(cyphers.ev);
    
    // Setup hot reload
    loadPlugins();
    setupHotReload();
    
    // Message handler with improved DM handling
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
            
            // Check if it's a DM (not a group)
            const isDM = !m.chat.endsWith('@g.us');
            
            // Send welcome message for first-time DM users
            if (isDM && !m.key.fromMe) {
                const userId = m.sender;
                if (!firstTimeUsers.has(userId)) {
                    firstTimeUsers.set(userId, true);
                    
                    // Get bot's own phone number from credentials
                    const botPhone = state.creds.me?.id?.split(':')[0] || state.creds.me?.id;
                    
                    const welcomeMessage = `👋 *Welcome to CYPHERS Bot!*\n\n` +
                        `To avoid "waiting for message" warnings:\n` +
                        `1. *Save this number* as a contact\n` +
                        `2. Name it "CYPHERS Bot"\n` +
                        `3. Messages will appear normally\n\n` +
                        `📱 *Bot Number:* \`${botPhone}\`\n` +
                        `⚙️ *Prefix:* ${prefix}\n\n` +
                        `Type \`${prefix}help\` to see all commands!`;
                    
                    // Send welcome without quoting
                    await cyphers.sendMessage(m.chat, { text: welcomeMessage });
                }
            }
            
            if (messageText.startsWith(prefix)) {
                const args = messageText.slice(prefix.length).trim().split(/ +/);
                const commandName = args.shift().toLowerCase();
                const quoted = m.quoted || null;
                
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
                        // Send error without quoting in DMs
                        const sendOptions = isDM ? {} : { quoted: m };
                        await cyphers.sendMessage(m.chat, { 
                            text: `❌ Error: ${error.message}` 
                        }, sendOptions);
                    }
                } else {
                    const commandList = Object.values(plugins)
                        .map(p => `${prefix}${p.name} - ${p.description || 'No description'}`)
                        .join('\n');
                    
                    // Send without quoting in DMs
                    const sendOptions = isDM ? {} : { quoted: m };
                    await cyphers.sendMessage(m.chat, { 
                        text: `❓ Command not found!\n\n📋 Available Commands:\n${commandList || 'No commands loaded'}\n\n💡 Tip: Save my number to avoid "waiting" messages!` 
                    }, sendOptions);
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
    
    // Only your channel
    global.idch1 = "0029Vb7KKdB8V0toQKtI3n2j@newsletter";

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
            console.log('\x1b[32m═══════════════════════════════════════════════════\x1b[0m');
            console.log('\x1b[32m║        ✅ CYPHERS BOT CONNECTED        ║\x1b[0m');
            console.log(`\x1b[32m║     📦 ${Object.keys(plugins).length} plugins loaded    ║\x1b[0m`);
            console.log('\x1b[32m║     🤖 Bot is ready to receive commands ║\x1b[0m');
            console.log('\x1b[32m═══════════════════════════════════════════════════\x1b[0m');
            
            // Try to follow your channel
            try {
                await cyphers.newsletterFollow(global.idch1);
                console.log(color(`✅ Following your channel`, 'green'));
            } catch (error) {
                console.log(color(`⚠️ Could not follow channel: ${error.message}`, 'yellow'));
            }
        }
    });

    // Override sendMessage to handle DMs better
    const originalSendMessage = cyphers.sendMessage;
    cyphers.sendMessage = async function(jid, content, options = {}) {
        try {
            // Remove quoted messages in DMs to avoid "waiting" issues
            const isGroup = jid.endsWith('@g.us');
            if (!isGroup && options.quoted) {
                // Create new options without quoted
                const { quoted, ...otherOptions } = options;
                return await originalSendMessage.call(this, jid, content, otherOptions);
            }
            return await originalSendMessage.call(this, jid, content, options);
        } catch (error) {
            console.log(color(`Send message error: ${error.message}`, 'red'));
            throw error;
        }
    };

    cyphers.sendText = (jid, text, quoted = '', options) => {
        const isGroup = jid.endsWith('@g.us');
        const sendOptions = isGroup ? { quoted, ...options } : { ...options };
        return cyphers.sendMessage(jid, { text: text, ...sendOptions });
    };
    
    // Helper method for plugins to use
    cyphers.reply = async (jid, text, quotedMessage = null, options = {}) => {
        const isGroup = jid.endsWith('@g.us');
        const sendOptions = isGroup && quotedMessage ? { quoted: quotedMessage, ...options } : options;
        return cyphers.sendMessage(jid, { text }, sendOptions);
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

cyphersStart();

// Watch main file for changes
let file = require.resolve(__filename);
fs.watchFile(file, () => {
    fs.unwatchFile(file);
    console.log('\x1b[0;32m' + __filename + ' \x1b[1;32mupdated!\x1b[0m');
    delete require.cache[file];
    require(file);
});
