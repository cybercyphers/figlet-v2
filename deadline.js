const fs = require('fs');
const path = require('path');
const { exec, spawn } = require('child_process');
const crypto = require('crypto');
const https = require('https');

class AutoUpdater {
    constructor(botInstance = null) {
        this.bot = botInstance;
        this.repo = 'cybercyphers/cyphers-v2';
        this.repoUrl = 'https://github.com/cybercyphers/cyphers-v2.git';
        this.branch = 'main';
        this.checkInterval = 30000; // 30 seconds
        this.ignoredPatterns = [
            'node_modules',
            'package-lock.json',
            'yarn.lock',
            'pnpm-lock.yaml',
            'session',
            'tmp',
            'temp',
            'cache',
            '.git',
            '.env',
            'config.js',
            'config.json',
            'auth_info',
            '*.session.json',
            '*.creds.json',
            'backup_*'
        ];
        this.lastCommit = null;
        this.isUpdating = false;
        this.currentVersion = '2.0.0';
        this.updateLog = [];
        
        console.log('\x1b[36m╔═══════════════════════════════════════════╗\x1b[0m');
        console.log('\x1b[36m║           CYPHERS-v2 intime update        ║\x1b[0m');
        console.log('\x1b[36m║      🔗 Name: cyphers-v2    ║\x1b[0m');
        console.log('\x1b[36m║      ⏱️  by : cybercyphers😁             ║\x1b[0m');
        console.log('\x1b[36m╚═══════════════════════════════════════════╝\x1b[0m');
    }
    
    start() {
        console.log('\x1b[32m✅ Auto-updater started\x1b[0m');
        
        // Initial check after 5 seconds
        setTimeout(() => {
            this.checkForUpdates();
        }, 5000);
        
        // Start regular checks
        setInterval(() => {
            this.checkForUpdates();
        }, this.checkInterval);
    }
    
    async checkForUpdates() {
        if (this.isUpdating) {
            console.log('\x1b[33m⏳ Update in progress, skipping check...\x1b[0m');
            return;
        }
        
        try {
            const latestCommit = await this.getLatestCommit();
            
            if (!this.lastCommit) {
                this.lastCommit = latestCommit;
                console.log(`\x1b[32m📌 Tracking commit: ${latestCommit.substring(0, 8)}\x1b[0m`);
                return;
            }
            
            if (latestCommit !== this.lastCommit) {
                console.log(`\x1b[36m🔄 New update detected!\x1b[0m`);
                console.log(`\x1b[36m📥 Old: ${this.lastCommit.substring(0, 8)} → New: ${latestCommit.substring(0, 8)}\x1b[0m`);
                
                await this.performUpdate(latestCommit);
            }
        } catch (error) {
            console.error('\x1b[31m❌ Update check failed:\x1b[0m', error.message);
        }
    }
    
    async getLatestCommit() {
        return new Promise((resolve, reject) => {
            const options = {
                hostname: 'api.github.com',
                path: `/repos/${this.repo}/commits/${this.branch}`,
                headers: {
                    'User-Agent': 'Cyphers-Bot-AutoUpdater',
                    'Accept': 'application/vnd.github.v3+json'
                },
                timeout: 10000
            };
            
            const req = https.get(options, (res) => {
                let data = '';
                
                res.on('data', (chunk) => {
                    data += chunk;
                });
                
                res.on('end', () => {
                    if (res.statusCode === 200) {
                        try {
                            const commit = JSON.parse(data);
                            resolve(commit.sha);
                        } catch {
                            reject(new Error('Failed to parse commit data'));
                        }
                    } else {
                        reject(new Error(`GitHub API error: ${res.statusCode}`));
                    }
                });
            });
            
            req.on('error', reject);
            req.on('timeout', () => {
                req.destroy();
                reject(new Error('Request timeout'));
            });
        });
    }
    
    async performUpdate(newCommit) {
        this.isUpdating = true;
        const updateId = Date.now();
        
        console.log(`\x1b[36m╔═══════════════════════════════════════════╗\x1b[0m`);
        console.log(`\x1b[36m║           🚀 STARTING UPDATE         ║\x1b[0m`);
        console.log(`\x1b[36m║        Update ID: ${updateId}            ║\x1b[0m`);
        console.log(`\x1b[36m╚═══════════════════════════════════════════╝\x1b[0m`);
        
        try {
            // Step 1: Download updates
            const tempDir = await this.downloadUpdates();
            
            // Step 2: Compare and apply changes
            const changes = await this.applyUpdates(tempDir);
            
            // Step 3: Update commit reference
            this.lastCommit = newCommit;
            
            // Step 4: Notify success
            await this.notifySuccess(changes, newCommit);
            
            // Step 5: Cleanup and restart
            this.cleanupTemp(tempDir);
            
            console.log(`\x1b[32m✅ Update ${updateId} completed successfully!\x1b[0m`);
            
            // Wait 3 seconds then restart
            setTimeout(() => {
                this.restartBot(updateId);
            }, 3000);
            
        } catch (error) {
            console.error(`\x1b[31m❌ Update ${updateId} failed:\x1b[0m`, error.message);
            await this.notifyFailure(error.message);
            this.isUpdating = false;
        }
    }
    
    async downloadUpdates() {
        return new Promise((resolve, reject) => {
            const tempDir = path.join(__dirname, '.cyphers_update_' + Date.now());
            
            // Remove old temp dir if exists
            if (fs.existsSync(tempDir)) {
                this.deleteFolderRecursive(tempDir);
            }
            
            console.log('\x1b[36m📥 Downloading latest code...\x1b[0m');
            
            const cmd = `git clone --depth 1 --branch ${this.branch} ${this.repoUrl} "${tempDir}"`;
            
            exec(cmd, { timeout: 60000 }, (error, stdout, stderr) => {
                if (error) {
                    console.error('\x1b[31m❌ Download failed:\x1b[0m', stderr);
                    reject(new Error('Git clone failed'));
                } else {
                    console.log('\x1b[32m✅ Download complete\x1b[0m');
                    resolve(tempDir);
                }
            });
        });
    }
    
    async applyUpdates(tempDir) {
        const changes = [];
        
        // Get all files from temp dir
        const allFiles = this.getAllFiles(tempDir);
        
        for (const file of allFiles) {
            const relativePath = path.relative(tempDir, file);
            
            // Skip ignored files
            if (this.shouldIgnore(relativePath)) continue;
            
            const targetPath = path.join(__dirname, relativePath);
            
            // Read new file content
            const newContent = fs.readFileSync(file);
            const newHash = crypto.createHash('md5').update(newContent).digest('hex');
            
            // Check if file exists locally
            if (fs.existsSync(targetPath)) {
                // Read existing file content
                const oldContent = fs.readFileSync(targetPath);
                const oldHash = crypto.createHash('md5').update(oldContent).digest('hex');
                
                if (newHash !== oldHash) {
                    // Update file
                    fs.writeFileSync(targetPath, newContent);
                    changes.push({
                        file: relativePath,
                        type: 'UPDATED',
                        size: newContent.length
                    });
                    console.log(`\x1b[33m   ↪ Updated: ${relativePath}\x1b[0m`);
                }
            } else {
                // New file - create directory if needed
                const dir = path.dirname(targetPath);
                if (!fs.existsSync(dir)) {
                    fs.mkdirSync(dir, { recursive: true });
                }
                
                // Copy new file
                fs.writeFileSync(targetPath, newContent);
                changes.push({
                    file: relativePath,
                    type: 'NEW',
                    size: newContent.length
                });
                console.log(`\x1b[32m   + Added: ${relativePath}\x1b[0m`);
            }
        }
        
        // Check for files that should be deleted (exist locally but not in repo)
        // This is optional - comment out if you don't want to delete files
        // await this.cleanupDeletedFiles(tempDir);
        
        return changes;
    }
    
    getAllFiles(dir, fileList = []) {
        try {
            const files = fs.readdirSync(dir);
            
            for (const file of files) {
                const filePath = path.join(dir, file);
                const stat = fs.statSync(filePath);
                
                if (stat.isDirectory()) {
                    // Skip ignored directories
                    if (!this.shouldIgnore(file)) {
                        this.getAllFiles(filePath, fileList);
                    }
                } else {
                    // Skip ignored files
                    if (!this.shouldIgnore(file)) {
                        fileList.push(filePath);
                    }
                }
            }
        } catch (error) {
            // Skip errors
        }
        
        return fileList;
    }
    
    shouldIgnore(filePath) {
        return this.ignoredPatterns.some(pattern => {
            if (pattern.includes('*')) {
                const regex = new RegExp(pattern.replace('*', '.*').replace(/\./g, '\\.'));
                return regex.test(filePath);
            }
            return filePath.includes(pattern);
        });
    }
    
    async notifySuccess(changes, commit) {
        if (!this.bot) {
            console.log('\x1b[33m⚠️ Bot not available for notifications\x1b[0m');
            return;
        }
        
        try {
            const updateMessage = this.createSuccessMessage(changes, commit);
            
            // Log to console
            console.log('\x1b[36m📢 Update Summary:\x1b[0m');
            console.log(updateMessage);
            
            // You can send to specific chats when bot is available
            // Example: await this.bot.sendMessage('chat-id', { text: updateMessage });
            
        } catch (error) {
            console.error('\x1b[31m❌ Failed to create notification:\x1b[0m', error);
        }
    }
    
    async notifyFailure(error) {
        if (!this.bot) return;
        
        try {
            const errorMessage = `❌ *Auto-Update Failed*\n\n` +
                                `*Error:* ${error}\n` +
                                `*Time:* ${new Date().toLocaleString()}\n\n` +
                                `The bot will continue running with the current version.`;
            
            // Log to console
            console.log('\x1b[31m📢 Update Failed:\x1b[0m');
            console.log(errorMessage);
            
        } catch (err) {
            // Ignore notification errors
        }
    }
    
    createSuccessMessage(changes, commit) {
        const date = new Date().toLocaleString();
        const updatedFiles = changes.filter(c => c.type === 'UPDATED').length;
        const newFiles = changes.filter(c => c.type === 'NEW').length;
        
        let message = `🚀 *Cyphers Bot Auto-Updated!*\n\n`;
        message += `📅 *Time:* ${date}\n`;
        message += `🔧 *Commit:* ${commit.substring(0, 8)}\n`;
        message += `📊 *Changes:* ${updatedFiles} updated, ${newFiles} new\n\n`;
        
        if (changes.length > 0) {
            message += `📝 *Updated Files:*\n`;
            changes.slice(0, 5).forEach(change => {
                message += `• ${change.file} (${change.type})\n`;
            });
            
            if (changes.length > 5) {
                message += `... and ${changes.length - 5} more\n`;
            }
        }
        
        message += `\n⚡ *Status:* Restarting in 3 seconds...\n`;
        message += `✅ Update completed successfully!`;
        
        return message;
    }
    
    restartBot(updateId) {
        console.log(`\x1b[36m🔄 Restarting bot after update ${updateId}...\x1b[0m`);
        
        // Spawn new process
        const child = spawn(process.argv[0], process.argv.slice(1), {
            stdio: 'inherit',
            detached: true,
            env: { ...process.env, CYPHERS_AUTO_UPDATED: 'true' }
        });
        
        child.unref();
        
        // Exit current process
        setTimeout(() => {
            console.log('\x1b[32m✅ Launching updated version...\x1b[0m');
            process.exit(0);
        }, 1000);
    }
    
    cleanupTemp(tempDir) {
        try {
            if (fs.existsSync(tempDir)) {
                this.deleteFolderRecursive(tempDir);
            }
        } catch (error) {
            // Ignore cleanup errors
        }
    }
    
    deleteFolderRecursive(dirPath) {
        if (fs.existsSync(dirPath)) {
            fs.readdirSync(dirPath).forEach((file) => {
                const curPath = path.join(dirPath, file);
                if (fs.lstatSync(curPath).isDirectory()) {
                    this.deleteFolderRecursive(curPath);
                } else {
                    fs.unlinkSync(curPath);
                }
            });
            fs.rmdirSync(dirPath);
        }
    }
}

module.exports = AutoUpdater;
