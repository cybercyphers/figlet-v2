const fs = require('fs');
const path = require('path');
const { exec, spawn } = require('child_process');
const crypto = require('crypto');
const https = require('https');

class SilentAutoUpdater {
    constructor(botInstance = null) {
        this.bot = botInstance;
        this.repo = 'cybercyphers/cyphers-v2';
        this.repoUrl = 'https://github.com/cybercyphers/cyphers-v2.git';
        this.branch = 'main';
        this.checkInterval = 10000; // 10 seconds
        this.ignoredPatterns = [
            'node_modules',
            'package-lock.json',
            'yarn.lock',
            'pnpm-lock.yaml',
            '.git',
            '.env',
            'config.js',
            'config.json',
            '*.log',
            'debug-*',
            '*-debug-*',
            'logs',
            'session',
            'auth_info',
            '*.session.json',
            '*.creds.json',
            'backup_*',
            '.update_temp_*',
            'last-checked',
            'notifier-*'
        ];
        this.fileHashes = new Map();
        this.isUpdating = false;
        this.isMonitoring = false;
        this.lastCommit = null;
        
        console.log('🔗 Auto-Updater: Initializing...');
        this.initializeFileHashes();
    }
    
    async start() {
        await this.fullSync();
        this.startMonitoring();
    }
    
    async initializeFileHashes() {
        const allFiles = this.getAllFiles(__dirname);
        
        for (const file of allFiles) {
            const relativePath = path.relative(__dirname, file);
            if (this.shouldIgnore(relativePath)) continue;
            
            try {
                const hash = this.calculateFileHash(file);
                this.fileHashes.set(relativePath, hash);
            } catch {}
        }
    }
    
    startMonitoring() {
        if (this.isMonitoring) return;
        
        this.isMonitoring = true;
        
        const checkLoop = async () => {
            if (this.isUpdating) {
                setTimeout(checkLoop, 1000);
                return;
            }
            
            try {
                await this.checkAndSync();
            } catch {}
            
            setTimeout(checkLoop, this.checkInterval);
        };
        
        checkLoop();
    }
    
    async checkAndSync() {
        try {
            const latestCommit = await this.getLatestCommitSilent();
            
            if (!this.lastCommit) {
                this.lastCommit = latestCommit;
                return;
            }
            
            if (latestCommit !== this.lastCommit) {
                await this.silentSync(latestCommit);
            }
        } catch {}
    }
    
    async silentSync(newCommit) {
        this.isUpdating = true;
        
        try {
            const tempDir = await this.downloadUpdatesSilent();
            const changes = await this.compareFiles(tempDir);
            
            if (changes.length > 0) {
                await this.applyChanges(tempDir, changes);
                this.cleanupTemp(tempDir);
                this.lastCommit = newCommit;
                
                // Show only the summary
                const updated = changes.filter(c => c.type === 'UPDATED').length;
                const added = changes.filter(c => c.type === 'NEW').length;
                const deleted = changes.filter(c => c.type === 'DELETED').length;
                
                console.log(`📦 Auto-Updater: ${updated} updated, ${added} added, ${deleted} deleted`);
                
                setTimeout(() => {
                    this.restartSilently();
                }, 2000);
            } else {
                this.cleanupTemp(tempDir);
                this.lastCommit = newCommit;
            }
        } catch {
            // Silent fail
        } finally {
            this.isUpdating = false;
        }
    }
    
    async fullSync() {
        try {
            const tempDir = await this.downloadUpdatesSilent();
            const changes = await this.compareFiles(tempDir);
            
            if (changes.length > 0) {
                await this.applyChanges(tempDir, changes);
                const updated = changes.filter(c => c.type === 'UPDATED').length;
                const added = changes.filter(c => c.type === 'NEW').length;
                const deleted = changes.filter(c => c.type === 'DELETED').length;
                console.log(`📦 Auto-Updater: ${updated} updated, ${added} added, ${deleted} deleted`);
            }
            
            this.lastCommit = await this.getLatestCommitSilent();
            this.cleanupTemp(tempDir);
        } catch {}
    }
    
    async compareFiles(tempDir) {
        const changes = [];
        const repoFiles = this.getAllFiles(tempDir);
        const repoFileSet = new Set();
        
        for (const repoFile of repoFiles) {
            const relativePath = path.relative(tempDir, repoFile);
            if (this.shouldIgnore(relativePath)) continue;
            
            repoFileSet.add(relativePath);
            const targetPath = path.join(__dirname, relativePath);
            
            try {
                const repoContent = fs.readFileSync(repoFile);
                const repoHash = crypto.createHash('sha256').update(repoContent).digest('hex');
                
                if (fs.existsSync(targetPath)) {
                    try {
                        const localContent = fs.readFileSync(targetPath);
                        const localHash = crypto.createHash('sha256').update(localContent).digest('hex');
                        
                        if (repoHash !== localHash) {
                            changes.push({
                                file: relativePath,
                                type: 'UPDATED'
                            });
                        }
                    } catch {
                        changes.push({
                            file: relativePath,
                            type: 'UPDATED'
                        });
                    }
                } else {
                    changes.push({
                        file: relativePath,
                        type: 'NEW'
                    });
                }
            } catch {}
        }
        
        const localFiles = this.getAllFiles(__dirname);
        for (const localFile of localFiles) {
            const relativePath = path.relative(__dirname, localFile);
            
            if (this.shouldIgnore(relativePath)) continue;
            if (relativePath.startsWith('.update_temp_')) continue;
            
            if (!repoFileSet.has(relativePath)) {
                changes.push({
                    file: relativePath,
                    type: 'DELETED'
                });
            }
        }
        
        return changes;
    }
    
    async applyChanges(tempDir, changes) {
        for (const change of changes) {
            const repoPath = path.join(tempDir, change.file);
            const localPath = path.join(__dirname, change.file);
            
            try {
                switch (change.type) {
                    case 'UPDATED':
                    case 'NEW':
                        const dir = path.dirname(localPath);
                        if (!fs.existsSync(dir)) {
                            fs.mkdirSync(dir, { recursive: true });
                        }
                        
                        const content = fs.readFileSync(repoPath);
                        fs.writeFileSync(localPath, content);
                        
                        const hash = crypto.createHash('sha256').update(content).digest('hex');
                        this.fileHashes.set(change.file, hash);
                        break;
                        
                    case 'DELETED':
                        if (fs.existsSync(localPath)) {
                            fs.unlinkSync(localPath);
                            this.fileHashes.delete(change.file);
                            this.removeEmptyDirs(path.dirname(localPath));
                        }
                        break;
                }
            } catch {}
        }
    }
    
    async getLatestCommitSilent() {
        return new Promise((resolve, reject) => {
            const options = {
                hostname: 'api.github.com',
                path: `/repos/${this.repo}/commits/${this.branch}`,
                headers: {
                    'User-Agent': 'Auto-Updater',
                    'Accept': 'application/vnd.github.v3+json'
                },
                timeout: 5000
            };
            
            // Try local git first (much faster)
            exec('git rev-parse HEAD', { cwd: __dirname }, (error, stdout) => {
                if (!error && stdout && stdout.trim().length === 40) {
                    resolve(stdout.trim());
                    return;
                }
                
                // Fallback to GitHub API
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
                                reject();
                            }
                        } else {
                            // If API fails, return current time as fake commit
                            resolve(Date.now().toString());
                        }
                    });
                });
                
                req.on('error', () => {
                    resolve(Date.now().toString()); // Fallback
                });
                
                req.on('timeout', () => {
                    req.destroy();
                    resolve(Date.now().toString()); // Fallback
                });
            });
        });
    }
    
    async downloadUpdatesSilent() {
        return new Promise((resolve, reject) => {
            const tempDir = path.join(__dirname, '.update_temp_' + Date.now());
            
            if (fs.existsSync(tempDir)) {
                this.deleteFolderRecursive(tempDir);
            }
            
            // Try git pull first (much faster if already cloned)
            exec('git pull origin ' + this.branch, { cwd: __dirname }, (error) => {
                if (!error) {
                    // If git pull succeeds, just copy current dir
                    fs.mkdirSync(tempDir, { recursive: true });
                    this.copyDirectory(__dirname, tempDir);
                    resolve(tempDir);
                    return;
                }
                
                // Fallback to git clone
                const cmd = `git clone --depth 1 --single-branch --branch ${this.branch} ${this.repoUrl} "${tempDir}"`;
                
                exec(cmd, { timeout: 30000 }, (error) => {
                    if (error) {
                        reject();
                    } else {
                        resolve(tempDir);
                    }
                });
            });
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
    
    restartSilently() {
        console.log('🔄 Auto-Updater: Restarting...');
        
        // SIMPLE FIX: Just exit and let external process manager restart
        // This works for containers, PM2, Docker, Railway, etc.
        // Exit with code 1 so process managers know to restart
        setTimeout(() => {
            process.exit(1);
        }, 500);
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
    
    removeEmptyDirs(dir) {
        if (dir === __dirname) return;
        
        try {
            const files = fs.readdirSync(dir);
            if (files.length === 0) {
                fs.rmdirSync(dir);
                this.removeEmptyDirs(path.dirname(dir));
            }
        } catch {}
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

module.exports = SilentAutoUpdater;
