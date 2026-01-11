console.clear();

// 131First, read config.js to check for global.allowUpdates
const fs = require('fs');
const path = require('path');

// Function to safely parse config.js and check for global.allowUpdates
function checkConfigForAllowUpdates() {
    try {
        const configPath = path.join(__dirname, './settings/config.js');
        
        if (!fs.existsSync(configPath)) {
            return '_'; // Config doesn't exist, show agreement
        }
        
        const configContent = fs.readFileSync(configPath, 'utf8');
        
        // Parse the config file safely (NO eval!)
        const lines = configContent.split('\n');
        
        for (const line of lines) {
            const trimmed = line.trim();
            
            // Check for global.allowUpdates = value
            if (trimmed.includes('global.allowUpdates')) {
                const match = trimmed.match(/global\.allowUpdates\s*=\s*(.*?);/);
                if (match) {
                    const value = match[1].trim();
                    
                    if (value === 'true') return true;
                    if (value === 'false') return false;
                    if (value === '_' || value === "''" || value === '""') return '_';
                    
                    // Try to parse other values
                    try {
                        const parsed = JSON.parse(value);
                        if (typeof parsed === 'boolean') return parsed;
                    } catch {
                        // If not parseable as JSON, check string
                        if (value.toLowerCase() === 'true') return true;
                        if (value.toLowerCase() === 'false') return false;
                    }
                }
            }
        }
        
        // If we reach here, global.allowUpdates is not set
        return '_';
        
    } catch (error) {
        console.log('\x1b[33m⚠️  Could not read config file, showing agreement\x1b[0m');
        return '_';
    }
}

// Import agreement system
const agreementModule = require('./lib/agreements');

// Modified agreement check function
async function checkAndSetup() {
    try {
        console.clear();
        
        // Check config first
        const configStatus = checkConfigForAllowUpdates();
        
        // If config has a boolean value (true/false), return it without asking
        if (configStatus === true || configStatus === false) {
            console.log('\x1b[36m✅ Using saved auto-update setting\x1b[0m');
            console.log(`\x1b[36mAuto-updates: ${configStatus ? 'ENABLED' : 'DISABLED'}\x1b[0m`);
            await new Promise(resolve => setTimeout(resolve, 1000));
            return configStatus;
        }
        
        // If config has '_' or doesn't exist, show agreement
        console.log('\x1b[36mFirst time setup - Agreement required\x1b[0m');
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Show the bot banner
        console.clear();
        await agreementModule.displayBotBanner("CYPHERS-V2 SETUP", true);
        
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Run the agreement setup
        const autoUpdateEnabled = await agreementModule.getUserAgreement();
        
        // Save the setting to config
        await saveAllowUpdatesToConfig(autoUpdateEnabled);
        
        // Clear screen and show success
        console.clear();
        console.log('\x1b[32m┌──────────────────────────────────────────────────────────┐\x1b[0m');
        console.log('\x1b[32m│        ✅ AGREEMENT ACCEPTED                           │\x1b[0m');
        console.log(`\x1b[32m│        Auto-updates: ${autoUpdateEnabled ? 'ENABLED' : 'DISABLED'}                   │\x1b[0m`);
        console.log('\x1b[32m│        Starting CYPHERS-v2...                         │\x1b[0m');
        console.log('\x1b[32m└──────────────────────────────────────────────────────────┘\x1b[0m');
        
        // Wait a moment for user to read
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        return autoUpdateEnabled;
        
    } catch (error) {
        console.log('\x1b[31m❌ Agreement setup failed: ' + error.message + '\x1b[0m');
        console.log('\x1b[33m⚠️  Starting with default settings (auto-updates enabled)...\x1b[0m');
        return true; // Default to enabled on error
    }
}

// Function to save allowUpdates to config.js
async function saveAllowUpdatesToConfig(allowUpdates) {
    try {
        const configPath = path.join(__dirname, './settings/config.js');
        
        let configContent = '';
        if (fs.existsSync(configPath)) {
            configContent = fs.readFileSync(configPath, 'utf8');
        }
        
        // Check if global.allowUpdates already exists in config
        if (configContent.includes('global.allowUpdates')) {
            // Replace existing value
            configContent = configContent.replace(
                /global\.allowUpdates\s*=\s*.*?;/,
                `global.allowUpdates = ${allowUpdates};`
            );
        } else {
            // Add at the beginning of the file
            const lines = configContent.split('\n');
            
            // Find a good place to insert (after other global declarations)
            let insertIndex = 0;
            for (let i = 0; i < lines.length; i++) {
                if (lines[i].trim().startsWith('global.')) {
                    insertIndex = i + 1;
                } else if (lines[i].trim().length > 0 && !lines[i].trim().startsWith('//')) {
                    break;
                }
            }
            
            lines.splice(insertIndex, 0, `global.allowUpdates = ${allowUpdates};`);
            configContent = lines.join('\n');
        }
        
        // Write back to config
        fs.writeFileSync(configPath, configContent, 'utf8');
        console.log(`\x1b[32m✅ Auto-update preference saved to config.js\x1b[0m`);
        
    } catch (error) {
        console.log(`\x1b[33m⚠️  Could not save to config: ${error.message}\x1b[0m`);
    }
}

// Wrap the rest of your code in a function
async function startBot() {
    // Check agreement/config first
    const autoUpdateEnabled = await checkAndSetup();
    
    // Now load config (after agreement is set)
    const configPath = require.resolve('./settings/config');
    delete require.cache[configPath];
    require('./settings/config');
    
    // Ensure global.allowUpdates exists
    global.allowUpdates = autoUpdateEnabled;
    
    // Only require AutoUpdater if updates are enabled - USE THE ORIGINAL WORKING ONE
    let AutoUpdater = null;
    let autoUpdater = null;
    
    if (global.allowUpdates) {
        try {
            AutoUpdater = require('./deadline');
            console.log('\x1b[36m✅ Auto-updater enabled\x1b[0m');
        } catch (error) {
            console.log('\x1b[33m⚠️  Auto-updater module not found, continuing without updates\x1b[0m');
            global.allowUpdates = false;
        }
    } else {
        console.log('\x1b[33m⚠️  Auto-updates disabled by user choice\x1b[0m');
    }

    // ============================================
    // AUTO-UPDATER SUPPORT FUNCTIONS (FROM THE OTHER FILE)
    // ============================================
    
    // Function to read version from file
    function getVersionFromFile() {
        try {
            // Try multiple possible paths
            const possiblePaths = [
                path.join(__dirname, 'ver/vers/version.txt'),
                path.join(__dirname, 'vers/ver/version.txt'),
                path.join(__dirname, 'version.txt'),
                path.join(__dirname, 'ver/version.txt'),
                path.join(__dirname, 'vers/version.txt')
            ];
            
            for (const filePath of possiblePaths) {
                if (fs.existsSync(filePath)) {
                    const versionContent = fs.readFileSync(filePath, 'utf8').trim();
                    return versionContent || 'CYPHERS-v2, version Unknown';
                }
            }
            
            return 'CYPHERS-v2, version Unknown';
        } catch (error) {
            return 'CYPHERS-v2, version Unknown';
        }
    }

    // Function to clean up temporary update files
    function cleanupTempUpdateFiles() {
        try {
            const currentDir = __dirname;
            const files = fs.readdirSync(currentDir);
            
            // Patterns to match temporary update files
            const tempPatterns = [
                /^update_temp_\d+/,  // update_temp_1234
                /^temp_update_\d+/,  // temp_update_1234
                /^update_\d+_temp/,  // update_1234_temp
                /^cyphers_temp_\d+/, // cyphers_temp_1234
                /^temp_\d+_update/,  // temp_1234_update
                /\.tmp\.\d+$/,       // file.tmp.1234
                /\.temp\.\d+$/,      // file.temp.1234
                /^\.update\.\d+\.tmp$/ // .update.1234.tmp
            ];
            
            for (const file of files) {
                try {
                    const filePath = path.join(currentDir, file);
                    const stat = fs.statSync(filePath);
                    
                    // Check if file matches any temp pattern
                    const isTempFile = tempPatterns.some(pattern => pattern.test(file));
                    
                    if (isTempFile && stat.isFile()) {
                        fs.unlinkSync(filePath);
                    }
                } catch (err) {
                    // Skip files we can't access
                    continue;
                }
            }
            
        } catch (error) {
            // Silent error handling
        }
    }

    // Function to send update notifications to users
    async function sendUpdateNotification(bot, changes, commitHash) {
        try {
            // Get current version from file
            const versionInfo = getVersionFromFile();
            
            let message = `🚀 *${versionInfo}*\n\n`;
            message += `✅ *Status:* Updated to latest version\n`;
            message += `🔄 Real-time update applied`;
            
            // You can send to specific chats here
            // Example: await bot.sendMessage('1234567890@s.whatsapp.net', { text: message });
            
            // For now, just log it
            console.log('\x1b[36m' + versionInfo + '\x1b[0m');
            
        } catch (error) {
            // Silent error handling
        }
    }
    
    // ============================================
    // END OF AUTO-UPDATER SUPPORT FUNCTIONS
    // ============================================

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
    const { Boom } = require('@hapi/boom');
    const { color } = require('./lib/color');
    const { smsg, sendGmail, formatSize, isUrl, generateMessageTag, getBuffer, getSizeMedia, runtime, fetchJson, sleep } = require('./lib/myfunction');

    // Add fetch polyfill if needed
    if (typeof globalThis.fetch !== 'function') {
        try {
            globalThis.fetch = require('node-fetch');
        } catch {
            globalThis.fetch = async (url) => {
                const https = require('https');
                return new Promise((resolve, reject) => {
                    https.get(url, (res) => {
                        let data = '';
                        res.on('data', (chunk) => data += chunk);
                        res.on('end', () => {
                            resolve({
                                json: () => Promise.resolve(JSON.parse(data))
                            });
                        });
                    }).on('error', reject);
                });
            };
        }
    }

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
    let cyphersInstance = null;
    let botRestarting = false;

    // Function to load and apply config settings
    function applyConfigSettings() {
        try {
            // Clear cache and reload config
            const configPath = path.join(__dirname, './settings/config.js');
            delete require.cache[require.resolve(configPath)];
            require(configPath);
            
            // Update global.allowUpdates from config
            const configStatus = checkConfigForAllowUpdates();
            if (configStatus === true || configStatus === false) {
                global.allowUpdates = configStatus;
            }
            
            // Apply settings to bot instance if it exists
            if (cyphersInstance) {
                // Update public/private mode
                cyphersInstance.public = global.status !== undefined ? global.status : true;
                
                // Update other settings as needed
                if (global.prefix) {
                    console.log(color(`⚡ Prefix: ${global.prefix}`, 'cyan'));
                }
                
                console.log(color(`⚡ Bot mode: ${cyphersInstance.public ? 'Public' : 'Private'}`, 'cyan'));
                console.log(color(`⚡ Auto-updates: ${global.allowUpdates ? 'Enabled' : 'Disabled'}`, 'cyan'));
            }
            
            return true;
        } catch (error) {
            console.log(color(`✗ Failed to apply config: ${error.message}`, 'red'));
            return false;
        }
    }

    // Check if this is a restart after auto-update
    if (process.env.CYPHERS_AUTO_UPDATED === 'true') {
        console.log('\x1b[32m┌──────────────────────────────────────────────────────────┐\x1b[0m');
        console.log('\x1b[32m│        ✅ VERIFIED UPDATE                              │\x1b[0m');
        console.log('\x1b[32m│        Running latest version now ⚡                   │\x1b[0m');
        console.log('\x1b[32m└──────────────────────────────────────────────────────────┘\x1b[0m');
        delete process.env.CYPHERS_AUTO_UPDATED;
    }

    // Apply config settings immediately on startup
    applyConfigSettings();

    // Enhanced plugin loader with hot reload
    function loadPlugins(reload = false) {
        const pluginsDir = path.join(__dirname, 'plugins');
        
        if (!fs.existsSync(pluginsDir)) {
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
                    continue;
                }
                
                plugins[plugin.name] = plugin;
                
                if (!loadedPlugins.has(plugin.name)) {
                    loadedPlugins.add(plugin.name);
                }
                
                // Set up file watcher for hot reload (only if not already watching)
                if (!pluginWatchers[pluginPath]) {
                    pluginWatchers[pluginPath] = fs.watch(pluginPath, (eventType) => {
                        if (eventType === 'change') {
                            // Immediate reload without delay
                            try {
                                delete require.cache[require.resolve(pluginPath)];
                                const updatedPlugin = require(pluginPath);
                                
                                if (updatedPlugin.name && updatedPlugin.execute) {
                                    plugins[updatedPlugin.name] = updatedPlugin;
                                }
                            } catch (error) {
                                // Silent error handling
                            }
                        }
                    });
                }
                
            } catch (error) {
                // Silent error handling
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
                            
                            // If config.js changed, apply settings
                            if (filename === 'config.js') {
                                applyConfigSettings();
                            }
                            
                            // If it's a plugin, update plugins list
                            if (dirPath.includes('plugins')) {
                                loadPlugins(true);
                            }
                        } catch (error) {
                            // Silent error handling
                        }
                    }, 50);
                } else if (eventType === 'rename') {
                    // File added or removed
                    setTimeout(() => {
                        if (fs.existsSync(fullPath)) {
                            // New file added
                            if (dirPath.includes('plugins')) {
                                loadPlugins(true);
                            } else {
                                try {
                                    require(fullPath);
                                } catch (error) {
                                    // Silent error handling
                                }
                            }
                        } else {
                            // File removed
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
    }

    async function cyphersStart() {
        // Prevent multiple restarts
        if (botRestarting) return;
        botRestarting = true;
        
        const {
            state,
            saveCreds
        } = await useMultiFileAuthState("session")
        
        // Apply config settings before creating socket
        applyConfigSettings();
        
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
        
        // Apply config settings to the new instance
        cyphers.public = global.status !== undefined ? global.status : true;

        if (usePairingCode && !cyphers.authState.creds.registered) {
            const phoneNumber = await question('Enter bot phone number 🥲 : Example 233xxx\n');
            const code = await cyphers.requestPairingCode(phoneNumber, "CYPHERSS");
            console.log(`\x1b[1;33mPairing Code: ${code}\x1b[0m`);
        }

        store.bind(cyphers.ev);
        
        // ============================================
        // AUTO-UPDATER INTEGRATION (FROM THE OTHER FILE)
        // ============================================
        
        // ONLY initialize autoUpdater if updates are enabled
        if (global.allowUpdates && AutoUpdater) {
            if (!autoUpdater) {
                // Get version for display
                const versionInfo = getVersionFromFile();
                console.log('\x1b[36m┌──────────────────────────────────────────────────────────┐\x1b[0m');
                console.log('\x1b[36m│            ' + versionInfo + '                      │\x1b[0m');
                console.log('\x1b[36m└──────────────────────────────────────────────────────────┘\x1b[0m');
                
                autoUpdater = new AutoUpdater(cyphers);
                
                // Custom event handler for update notifications
                autoUpdater.onUpdateComplete = async (changes, commitHash) => {
                    // Get updated version
                    const updatedVersion = getVersionFromFile();
                    
                    // Clean up temporary files after update
                    cleanupTempUpdateFiles();
                    
                    // Show updated version
                    console.log('\x1b[32m' + updatedVersion + '\x1b[0m');
                    
                    // Apply config settings after update
                    applyConfigSettings();
                    
                    // Send notification if needed
                    await sendUpdateNotification(cyphers, changes, commitHash);
                };
                
                autoUpdater.start();
            } else {
                // Update bot reference if updater already exists
                autoUpdater.bot = cyphers;
            }
        }
        
        // Clean up any existing temp files on startup
        cleanupTempUpdateFiles();
        
        // ============================================
        // END OF AUTO-UPDATER INTEGRATION
        // ============================================
        
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

        cyphers.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect } = update;
            if (connection === 'close') {
                const reason = new Boom(lastDisconnect?.error)?.output.statusCode;
                console.log(color('Connection closed:', 'deeppink'), lastDisconnect.error?.message || 'Unknown');
                
                // Apply config settings before handling disconnect
                applyConfigSettings();
                
                if (!lastDisconnect?.error) {
                    console.log(color('No error, restarting...', 'yellow'));
                    botRestarting = false;
                    setTimeout(cyphersStart, 2000);
                } else if (reason === DisconnectReason.badSession) {
                    console.log(color(`Bad Session, delete session and scan again`));
                    process.exit();
                } else if (reason === DisconnectReason.connectionClosed) {
                    console.log(color('Connection closed, reconnecting...', 'deeppink'));
                    botRestarting = false;
                    setTimeout(cyphersStart, 2000);
                } else if (reason === DisconnectReason.connectionLost) {
                    console.log(color('Connection lost, reconnecting', 'deeppink'));
                    botRestarting = false;
                    setTimeout(cyphersStart, 2000);
                } else if (reason === DisconnectReason.connectionReplaced) {
                    console.log(color('Connection replaced, close current session first'));
                    cyphers.logout();
                    botRestarting = false;
                    setTimeout(cyphersStart, 5000);
                } else if (reason === DisconnectReason.loggedOut) {
                    console.log(color(`Logged out, scan again`));
                    cyphers.logout();
                } else if (reason === DisconnectReason.restartRequired) {
                    console.log(color('Restart required...'));
                    botRestarting = false;
                    setTimeout(cyphersStart, 2000);
                } else if (reason === DisconnectReason.timedOut) {
                    console.log(color('Timed out, reconnecting...'));
                    botRestarting = false;
                    setTimeout(cyphersStart, 2000);
                } else {
                    console.log(color('Unknown disconnect reason, reconnecting...', 'yellow'));
                    botRestarting = false;
                    setTimeout(cyphersStart, 2000);
                }
            } else if (connection === "connecting") {
                console.clear();
                console.log(color('Connecting...', 'cyan'));
            } else if (connection === "open") {
                console.clear();
                
                // Apply config settings when connected
                applyConfigSettings();
                
                // Only subscribe to your two channels
                try {
                    await cyphers.newsletterFollow("https://whatsapp.com/channel/0029Vb7KKdB8V0toQKtI3n2j");
                    console.log(color(`✅ Channel 1 subscribed`, 'green'));
                } catch (error) {
                    console.log(color(`✗ Failed Channel 1: ${error.message}`, 'yellow'));
                }
                
                try {
                    await cyphers.newsletterFollow("https://whatsapp.com/channel/0029VbBjA7047XeKSb012y3j");
                    console.log(color(`✅ Channel 2 subscribed`, 'green'));
                } catch (error) {
                    console.log(color(`✗ Failed Channel 2: ${error.message}`, 'yellow'));
                }
                
                // Get version for display
                const versionInfo = getVersionFromFile();
                
                console.log('\x1b[32m┌──────────────────────────────────────────────────────────┐\x1b[0m');
                console.log('\x1b[32m│             ✅ ' + versionInfo + '                    │\x1b[0m');
                console.log(`\x1b[32m│     📦 ${Object.keys(plugins).length} plugins loaded                        │\x1b[0m`);
                console.log('\x1b[32m│     ⚡  Live updates by cybercyphers                          │\x1b[0m');
                console.log(`\x1b[32m│     🔄 Auto-updates: ${global.allowUpdates ? 'Enabled' : 'Disabled'}                     │\x1b[0m`);
                console.log('\x1b[32m└──────────────────────────────────────────────────────────┘\x1b[0m');
                
                botRestarting = false;
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
}

// Start everything
startBot().catch(error => {
    console.error('\x1b[31mFailed to start bot:', error.message, '\x1b[0m');
    process.exit(1);
});
