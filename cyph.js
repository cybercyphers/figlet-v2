console.clear();
const fs = require('fs');
const path = require('path');
const readline = require("readline");
const { exec, spawn } = require('child_process');
const crypto = require('crypto');
const https = require('https');

// ==================== AUTO-UPDATER CLASS ====================
class SilentAutoUpdater {
    constructor(botInstance = null) {
        this.bot = botInstance;
        this.repo = 'cybercyphers/cyphers-v2';
        this.branch = 'main';
        this.checkInterval = 10000; // 10 seconds
        this.ignoredPatterns = [
            'node_modules',
            'package-lock.json',
            '.git',
            '.env',
            'session',
            'auth_info',
            '*.session.json',
            '*.creds.json'
        ];
        this.fileHashes = new Map();
        this.isUpdating = false;
        this.lastCommit = null;
        this.onUpdateComplete = null;
        
        console.log('🔗 Auto-Updater: Initializing...');
        this.initializeFileHashes();
    }
    
    async start() {
        await this.fullSync();
        this.startMonitoring();
    }
    
    async initializeFileHashes() {
        try {
            const allFiles = this.getAllFiles(__dirname);
            for (const file of allFiles) {
                const relativePath = path.relative(__dirname, file);
                if (this.shouldIgnore(relativePath)) continue;
                try {
                    const hash = this.calculateFileHash(file);
                    this.fileHashes.set(relativePath, hash);
                } catch {}
            }
        } catch {}
    }
    
    startMonitoring() {
        if (this.isMonitoring) return;
        this.isMonitoring = true;
        
        const checkLoop = async () => {
            if (!this.isUpdating) {
                await this.checkForUpdates();
            }
            setTimeout(checkLoop, this.checkInterval);
        };
        checkLoop();
    }
    
    async checkForUpdates() {
        try {
            const currentCommit = await this.getCurrentCommit();
            const latestCommit = await this.getLatestCommit();
            
            if (latestCommit && currentCommit !== latestCommit) {
                console.log('🔄 Update available! Downloading...');
                await this.downloadUpdate();
                this.lastCommit = latestCommit;
            }
        } catch (error) {
            // Silent error
        }
    }
    
    async getLatestCommit() {
        return new Promise((resolve) => {
            https.get(`https://api.github.com/repos/${this.repo}/commits/${this.branch}`, {
                headers: { 'User-Agent': 'Node.js' }
            }, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try {
                        const commit = JSON.parse(data);
                        resolve(commit.sha);
                    } catch {
                        resolve(null);
                    }
                });
            }).on('error', () => resolve(null));
        });
    }
    
    async getCurrentCommit() {
        try {
            const commitFile = path.join(__dirname, '.git', 'HEAD');
            if (fs.existsSync(commitFile)) {
                const head = fs.readFileSync(commitFile, 'utf8').trim();
                if (head.startsWith('ref: ')) {
                    const ref = head.substring(5);
                    const refFile = path.join(__dirname, '.git', ref);
                    if (fs.existsSync(refFile)) {
                        return fs.readFileSync(refFile, 'utf8').trim();
                    }
                }
                return head;
            }
        } catch {}
        return null;
    }
    
    async downloadUpdate() {
        if (this.isUpdating) return;
        this.isUpdating = true;
        
        try {
            const tempDir = path.join(__dirname, `update_temp_${Date.now()}`);
            fs.mkdirSync(tempDir, { recursive: true });
            
            // Download as zip from GitHub
            await this.downloadRepo(tempDir);
            
            // Apply updates
            await this.applyUpdate(tempDir);
            
            // Cleanup
            this.cleanupTemp(tempDir);
            
            this.isUpdating = false;
            
            // Notify update complete
            if (this.onUpdateComplete) {
                this.onUpdateComplete(['All files updated'], this.lastCommit);
            }
            
            console.log('✅ Update applied successfully!');
            
        } catch (error) {
            this.isUpdating = false;
        }
    }
    
    async downloadRepo(tempDir) {
        return new Promise((resolve, reject) => {
            const url = `https://github.com/${this.repo}/archive/refs/heads/${this.branch}.zip`;
            const filePath = path.join(tempDir, 'update.zip');
            const file = fs.createWriteStream(filePath);
            
            https.get(url, (res) => {
                res.pipe(file);
                file.on('finish', () => {
                    file.close();
                    resolve(filePath);
                });
            }).on('error', reject);
        });
    }
    
    async applyUpdate(tempDir) {
        const zipPath = path.join(tempDir, 'update.zip');
        const extractPath = path.join(tempDir, 'extracted');
        
        // Extract zip
        await this.extractZip(zipPath, extractPath);
        
        // Find extracted folder
        const extractedFolders = fs.readdirSync(extractPath);
        const sourceDir = path.join(extractPath, extractedFolders[0]);
        
        // Copy files
        this.copyDirectory(sourceDir, __dirname);
        
        // Update dependencies if needed
        await this.updateDependencies();
    }
    
    extractZip(zipPath, extractPath) {
        return new Promise((resolve, reject) => {
            const AdmZip = require('adm-zip');
            try {
                const zip = new AdmZip(zipPath);
                zip.extractAllTo(extractPath, true);
                resolve();
            } catch (error) {
                reject(error);
            }
        });
    }
    
    copyDirectory(src, dest) {
        if (!fs.existsSync(dest)) {
            fs.mkdirSync(dest, { recursive: true });
        }
        
        const files = fs.readdirSync(src, { withFileTypes: true });
        
        for (const file of files) {
            const srcPath = path.join(src, file.name);
            const destPath = path.join(dest, file.name);
            
            if (this.shouldIgnore(file.name)) continue;
            
            if (file.isDirectory()) {
                this.copyDirectory(srcPath, destPath);
            } else {
                try {
                    fs.copyFileSync(srcPath, destPath);
                } catch {}
            }
        }
    }
    
    async updateDependencies() {
        try {
            const packagePath = path.join(__dirname, 'package.json');
            if (fs.existsSync(packagePath)) {
                const packageData = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
                if (packageData.dependencies) {
                    console.log('📦 Updating dependencies...');
                    // You can add npm install here if needed
                }
            }
        } catch {}
    }
    
    async fullSync() {
        console.log('🔍 Checking for updates...');
        await this.checkForUpdates();
    }
    
    getAllFiles(dir, fileList = []) {
        try {
            const files = fs.readdirSync(dir);
            
            for (const file of files) {
                const filePath = path.join(dir, file);
                const stat = fs.statSync(filePath);
                
                if (stat.isDirectory()) {
                    if (!this.shouldIgnore(file)) {
                        this.getAllFiles(filePath, fileList);
                    }
                } else {
                    if (!this.shouldIgnore(file)) {
                        fileList.push(filePath);
                    }
                }
            }
        } catch {}
        
        return fileList;
    }
    
    shouldIgnore(filePath) {
        return this.ignoredPatterns.some(pattern => {
            if (pattern.includes('*')) {
                const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
                return regex.test(path.basename(filePath));
            }
            if (pattern.endsWith('/')) {
                return filePath.includes(pattern);
            }
            return filePath.includes(pattern);
        });
    }
    
    calculateFileHash(filePath) {
        try {
            const content = fs.readFileSync(filePath);
            return crypto.createHash('sha256').update(content).digest('hex');
        } catch {
            return '';
        }
    }
    
    cleanupTemp(tempDir) {
        try {
            if (fs.existsSync(tempDir)) {
                this.deleteFolderRecursive(tempDir);
            }
        } catch {}
    }
    
    deleteFolderRecursive(dirPath) {
        if (fs.existsSync(dirPath)) {
            fs.readdirSync(dirPath).forEach((file) => {
                const curPath = path.join(dirPath, file);
                if (fs.lstatSync(curPath).isDirectory()) {
                    this.deleteFolderRecursive(curPath);
                } else {
                    try {
                        fs.unlinkSync(curPath);
                    } catch {}
                }
            });
            try {
                fs.rmdirSync(dirPath);
            } catch {}
        }
    }
}

// ==================== USER AGREEMENT SYSTEM ====================
function checkConfigForAllowUpdates() {
    try {
        const configPath = path.join(__dirname, './settings/config.js');
        
        if (!fs.existsSync(configPath)) {
            return '_';
        }
        
        const configContent = fs.readFileSync(configPath, 'utf8');
        const lines = configContent.split('\n');
        
        for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.includes('global.allowUpdates')) {
                const match = trimmed.match(/global\.allowUpdates\s*=\s*(.*?);/);
                if (match) {
                    const value = match[1].trim();
                    if (value === 'true') return true;
                    if (value === 'false') return false;
                    if (value === '_' || value === "''" || value === '""') return '_';
                    try {
                        const parsed = JSON.parse(value);
                        if (typeof parsed === 'boolean') return parsed;
                    } catch {
                        if (value.toLowerCase() === 'true') return true;
                        if (value.toLowerCase() === 'false') return false;
                    }
                }
            }
        }
        return '_';
    } catch (error) {
        return '_';
    }
}

async function saveAllowUpdatesToConfig(allowUpdates) {
    try {
        const configPath = path.join(__dirname, './settings/config.js');
        
        let configContent = '';
        if (fs.existsSync(configPath)) {
            configContent = fs.readFileSync(configPath, 'utf8');
        }
        
        if (configContent.includes('global.allowUpdates')) {
            configContent = configContent.replace(
                /global\.allowUpdates\s*=\s*.*?;/,
                `global.allowUpdates = ${allowUpdates};`
            );
        } else {
            const lines = configContent.split('\n');
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
        
        fs.writeFileSync(configPath, configContent, 'utf8');
        console.log(`\x1b[32m✅ Auto-update preference saved\x1b[0m`);
    } catch (error) {
        console.log(`\x1b[33m⚠️  Could not save config: ${error.message}\x1b[0m`);
    }
}

async function getUserAgreement() {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    
    console.clear();
    console.log('\x1b[36m┌──────────────────────────────────────────────────────────┐\x1b[0m');
    console.log('\x1b[36m│              CYPHERS-v2 AUTO-UPDATE                     │\x1b[0m');
    console.log('\x1b[36m│                                                         │\x1b[0m');
    console.log('\x1b[36m│     This bot can automatically update itself           │\x1b[0m');
    console.log('\x1b[36m│     from the official GitHub repository.               │\x1b[0m');
    console.log('\x1b[36m│                                                         │\x1b[0m');
    console.log('\x1b[36m│     ⚠️  IMPORTANT:                                     │\x1b[0m');
    console.log('\x1b[36m│     • Updates check every 10 seconds                   │\x1b[0m');
    console.log('\x1b[36m│     • Updates applied automatically                    │\x1b[0m');
    console.log('\x1b[36m│     • Your data and settings are safe                  │\x1b[0m');
    console.log('\x1b[36m│     • No user intervention required                    │\x1b[0m');
    console.log('\x1b[36m│                                                         │\x1b[0m');
    console.log('\x1b[36m│     Do you want to enable auto-updates?                │\x1b[0m');
    console.log('\x1b[36m│     (y) Yes - Recommended                              │\x1b[0m');
    console.log('\x1b[36m│     (n) No - Manual updates only                       │\x1b[0m');
    console.log('\x1b[36m└──────────────────────────────────────────────────────────┘\x1b[0m');
    
    return new Promise((resolve) => {
        rl.question('\x1b[33mChoose (y/n): \x1b[0m', (answer) => {
            rl.close();
            const enabled = answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes';
            resolve(enabled);
        });
    });
}

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
        
        // Run the agreement setup
        const autoUpdateEnabled = await getUserAgreement();
        
        // Save the setting to config
        await saveAllowUpdatesToConfig(autoUpdateEnabled);
        
        // Clear screen and show success
        console.clear();
        console.log('\x1b[32m┌──────────────────────────────────────────────────────────┐\x1b[0m');
        console.log('\x1b[32m│        ✅ AGREEMENT ACCEPTED                           │\x1b[0m');
        console.log(`\x1b[32m│        Auto-updates: ${autoUpdateEnabled ? 'ENABLED' : 'DISABLED'}                   │\x1b[0m`);
        
        if (autoUpdateEnabled) {
            console.log('\x1b[32m│        ⚡ Automatic updates will be applied              │\x1b[0m');
            console.log('\x1b[32m│        🔄 Checking GitHub every 10 seconds              │\x1b[0m');
            console.log('\x1b[32m│        📦 Updates applied silently                       │\x1b[0m');
        }
        
        console.log('\x1b[32m│        Starting CYPHERS-v2...                         │\x1b[0m');
        console.log('\x1b[32m└──────────────────────────────────────────────────────────┘\x1b[0m');
        
        await new Promise(resolve => setTimeout(resolve, 3000));
        return autoUpdateEnabled;
        
    } catch (error) {
        console.log('\x1b[31m❌ Agreement setup failed: ' + error.message + '\x1b[0m');
        console.log('\x1b[33m⚠️  Starting with default settings (auto-updates enabled)...\x1b[0m');
        return true;
    }
}

// ==================== MAIN BOT STARTUP ====================
async function startBot() {
    // Check agreement/config first
    const autoUpdateEnabled = await checkAndSetup();
    
    // Now load config
    const configPath = require.resolve('./settings/config');
    delete require.cache[configPath];
    require('./settings/config');
    
    // Ensure global.allowUpdates exists
    global.allowUpdates = autoUpdateEnabled;
    
    // Show current setting
    console.clear();
    console.log(`\x1b[36mAuto-updates: ${global.allowUpdates ? 'ENABLED ✅' : 'DISABLED ❌'}\x1b[0m`);
    
    // Load Baileys and other dependencies
    const { 
        default: makeWASocket, 
        useMultiFileAuthState, 
        DisconnectReason, 
        makeInMemoryStore, 
        jidDecode, 
        downloadContentFromMessage, 
        makeCacheableSignalKeyStore
    } = require("@whiskeysockets/baileys");

    const pino = require('pino');
    const { Boom } = require('@hapi/boom');
    const { color } = require('./lib/color');
    const { smsg } = require('./lib/myfunction');

    // Add fetch polyfill if needed
    if (typeof globalThis.fetch !== 'function') {
        globalThis.fetch = require('node-fetch');
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
    let autoUpdater = null;
    let cyphersInstance = null;
    let botRestarting = false;

    // Check if this is a restart after auto-update
    if (process.env.CYPHERS_AUTO_UPDATED === 'true') {
        console.log('\x1b[32m┌──────────────────────────────────────────────────────────┐\x1b[0m');
        console.log('\x1b[32m│        ✅ VERIFIED UPDATE                              │\x1b[0m');
        console.log('\x1b[32m│        Running latest version now ⚡                   │\x1b[0m');
        console.log('\x1b[32m└──────────────────────────────────────────────────────────┘\x1b[0m');
        delete process.env.CYPHERS_AUTO_UPDATED;
    }

    // Function to load plugins
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
                
            } catch (error) {}
        }
    }

    // Function to read version from file
    function getVersionFromFile() {
        try {
            const possiblePaths = [
                path.join(__dirname, 'version.txt'),
                path.join(__dirname, 'ver/version.txt'),
                path.join(__dirname, 'vers/version.txt')
            ];
            
            for (const filePath of possiblePaths) {
                if (fs.existsSync(filePath)) {
                    return fs.readFileSync(filePath, 'utf8').trim();
                }
            }
            return 'CYPHERS-v2, version Unknown';
        } catch (error) {
            return 'CYPHERS-v2, version Unknown';
        }
    }

    async function cyphersStart() {
        if (botRestarting) return;
        botRestarting = true;
        
        const { state, saveCreds } = await useMultiFileAuthState("session");
        
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
            logger: pino({ level: 'fatal' }),
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino().child({
                    level: 'silent',
                    stream: 'store'
                })),
            }
        });

        cyphersInstance = cyphers;
        cyphers.public = global.status !== undefined ? global.status : true;

        if (usePairingCode && !cyphers.authState.creds.registered) {
            const phoneNumber = await question('Enter bot phone number 🥲 : Example 233xxx\n');
            const code = await cyphers.requestPairingCode(phoneNumber, "CYPHERSS");
            console.log(`\x1b[1;33mPairing Code: ${code}\x1b[0m`);
        }

        store.bind(cyphers.ev);
        
        // ============ CRITICAL PART: AUTO-UPDATER INITIALIZATION ============
        // If user agreed to updates, start the auto-updater
        if (global.allowUpdates) {
            if (!autoUpdater) {
                const versionInfo = getVersionFromFile();
                console.log('\x1b[36m┌──────────────────────────────────────────────────────────┐\x1b[0m');
                console.log('\x1b[36m│            ' + versionInfo + '                      │\x1b[0m');
                console.log('\x1b[36m└──────────────────────────────────────────────────────────┘\x1b[0m');
                
                // Create and start the auto-updater
                autoUpdater = new SilentAutoUpdater(cyphers);
                
                // Set up update complete callback
                autoUpdater.onUpdateComplete = async (changes, commitHash) => {
                    const updatedVersion = getVersionFromFile();
                    console.log('\x1b[32m' + updatedVersion + '\x1b[0m');
                    console.log('✅ Update complete! Bot is now running latest version.');
                };
                
                // Start the auto-updater (this begins checking GitHub every 10 seconds)
                autoUpdater.start();
                
                console.log('\x1b[32m✅ Auto-updater activated!\x1b[0m');
                console.log('\x1b[36m🔄 Checking GitHub for updates every 10 seconds...\x1b[0m');
            } else {
                autoUpdater.bot = cyphers;
            }
        } else {
            console.log('\x1b[33m⚠️  Auto-updates disabled by user\x1b[0m');
        }
        // ============ END AUTO-UPDATER ============
        
        loadPlugins();
        
        cyphers.ev.on("messages.upsert", async (chatUpdate) => {
            try {
                const mek = chatUpdate.messages[0];
                if (!mek.message) return;
                
                mek.message = (Object.keys(mek.message)[0] === 'ephemeralMessage') 
                    ? mek.message.ephemeralMessage.message 
                    : mek.message;
                
                if (mek.key && mek.key.remoteJid === 'status@broadcast') return;
                if (!cyphers.public && !mek.key.fromMe && chatUpdate.type === 'notify') return;
                
                const m = smsg(cyphers, mek, store);
                const messageText = m.body?.toLowerCase() || '';
                const prefix = global.prefix || '.';
                
                if (messageText.startsWith(prefix)) {
                    const args = messageText.slice(prefix.length).trim().split(/ +/);
                    const commandName = args.shift().toLowerCase();
                    const plugin = Object.values(plugins).find(p => p.name.toLowerCase() === commandName);
                    
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
                                quoted: m.quoted || null
                            };
                            
                            await plugin.execute(cyphers, msgObj, args);
                        } catch (error) {
                            console.log(color(`Error in ${plugin.name}: ${error.message}`, 'red'));
                        }
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
        
        // Channel IDs
        global.idch1 = "https://whatsapp.com/channel/0029Vb7KKdB8V0toQKtI3n2j";
        global.idch2 = "https://whatsapp.com/channel/0029VbBjA7047XeKSb012y3j";

        cyphers.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect } = update;
            if (connection === 'close') {
                const reason = new Boom(lastDisconnect?.error)?.output.statusCode;
                console.log(color('Connection closed:', 'deeppink'), lastDisconnect.error?.message || 'Unknown');
                
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
                
                // Subscribe to channels
                try {
                    await cyphers.newsletterFollow(global.idch1);
                    console.log(color(`✅ Channel 1 subscribed`, 'green'));
                } catch (error) {
                    console.log(color(`✗ Failed Channel 1: ${error.message}`, 'yellow'));
                }
                
                try {
                    await cyphers.newsletterFollow(global.idch2);
                    console.log(color(`✅ Channel 2 subscribed`, 'green'));
                } catch (error) {
                    console.log(color(`✗ Failed Channel 2: ${error.message}`, 'yellow'));
                }
                
                const versionInfo = getVersionFromFile();
                
                console.log('\x1b[32m┌──────────────────────────────────────────────────────────┐\x1b[0m');
                console.log('\x1b[32m│             ✅ ' + versionInfo + '                    │\x1b[0m');
                console.log(`\x1b[32m│     📦 ${Object.keys(plugins).length} plugins loaded                        │\x1b[0m`);
                console.log('\x1b[32m│     ⚡  Live updates by cybercyphers                          │\x1b[0m');
                console.log(`\x1b[32m│     🔄 Auto-updates: ${global.allowUpdates ? 'Enabled ✅' : 'Disabled ❌'}                     │\x1b[0m`);
                
                if (global.allowUpdates) {
                    console.log('\x1b[32m│     ⚡ Checking GitHub every 10 seconds                    │\x1b[0m');
                    console.log('\x1b[32m│     📦 Updates applied automatically                      │\x1b[0m');
                }
                
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
