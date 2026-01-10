const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const crypto = require('crypto');
const https = require('https');
//🔥
class SilentAutoUpdater {
    constructor(botInstance = null) {
        this.bot = botInstance;
        this.repo = 'cybercyphers/cyphers-v2';
        this.repoUrl = 'https://github.com/cybercyphers/cyphers-v2.git';
        this.branch = 'main';
        this.checkInterval = 30000; // Check every 30 seconds
        this.ignoredPatterns = [
            'node_modules',
            'package-lock.json',
            'yarn.lock',
            'pnpm-lock.yaml',
            '.git',
            '.env',
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
            'notifier-*',
            'tmp/',
            'data/'
        ];
        this.protectedFiles = [
            'config.js',
            'settings/config.js',
            'data/antidelete.json'
        ];
        this.fileHashes = new Map();
        this.isUpdating = false;
        this.isMonitoring = false;
        this.lastCommit = null;
        this.onUpdateComplete = null;
        this.monitoringInterval = null;
        
        console.log('\x1b[36m🔗 Auto-Updater: Initializing...\x1b[0m');
        this.initializeFileHashes();
    }
    
    async start() {
        console.log('\x1b[36m🔄 Auto-Updater: Starting background monitoring...\x1b[0m');
        await this.fullSync();
        this.startMonitoring();
    }
    
    stop() {
        this.isMonitoring = false;
        if (this.monitoringInterval) {
            clearInterval(this.monitoringInterval);
            this.monitoringInterval = null;
        }
        console.log('\x1b[33m🔒 Auto-Updater: Background monitoring stopped\x1b[0m');
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
        console.log('\x1b[32m🔄 Auto-Updater: Background monitoring started\x1b[0m');
        console.log(`\x1b[36m📡 Checking repository every ${this.checkInterval/1000} seconds\x1b[0m`);
        
        // Start the monitoring loop
        this.monitoringInterval = setInterval(async () => {
            if (this.isUpdating || !this.isMonitoring) {
                return;
            }
            
            try {
                await this.checkAndSync();
            } catch (error) {
                console.log(`\x1b[33m⚠️  Auto-Updater: Check failed: ${error.message}\x1b[0m`);
            }
        }, this.checkInterval);
        
        // Also do an immediate check
        setTimeout(() => {
            if (this.isMonitoring) {
                this.checkAndSync().catch(() => {});
            }
        }, 5000);
    }
    
    async checkAndSync() {
        try {
            if (this.isUpdating) return;
            
            const latestCommit = await this.getLatestCommitSilent();
            
            if (!this.lastCommit) {
                this.lastCommit = latestCommit;
                return;
            }
            
            if (latestCommit !== this.lastCommit) {
                console.log('\x1b[33m🔄 Auto-Updater: New update detected in repository!\x1b[0m');
                await this.silentSync(latestCommit);
            }
        } catch (error) {
            console.log(`\x1b[33m⚠️  Auto-Updater: Check error: ${error.message}\x1b[0m`);
        }
    }
    
    async silentSync(newCommit) {
        if (this.isUpdating) return;
        this.isUpdating = true;
        
        try {
            console.log('\x1b[36m📥 Auto-Updater: Downloading updates...\x1b[0m');
            const tempDir = await this.downloadUpdatesSilent();
            const changes = await this.compareFiles(tempDir);
            
            if (changes.length > 0) {
                console.log(`\x1b[36m📦 Auto-Updater: Applying ${changes.length} changes...\x1b[0m`);
                await this.applyChanges(tempDir, changes);
                this.cleanupTemp(tempDir);
                this.lastCommit = newCommit;
                
                const updated = changes.filter(c => c.type === 'UPDATED').length;
                const added = changes.filter(c => c.type === 'NEW').length;
                const deleted = changes.filter(c => c.type === 'DELETED').length;
                
                console.log(`\x1b[32m✅ Auto-Updater: ${updated} updated, ${added} added, ${deleted} deleted\x1b[0m`);
                
                if (this.onUpdateComplete && typeof this.onUpdateComplete === 'function') {
                    this.onUpdateComplete(changes, newCommit);
                }
                
                this.reloadModifiedModules(changes);
            } else {
                this.cleanupTemp(tempDir);
                this.lastCommit = newCommit;
                console.log('\x1b[36m📦 Auto-Updater: No file changes detected\x1b[0m');
            }
        } catch (error) {
            console.log(`\x1b[31m❌ Auto-Updater: Sync failed: ${error.message}\x1b[0m`);
        } finally {
            this.isUpdating = false;
        }
    }
    
    async fullSync() {
        try {
            console.log('\x1b[36m🔄 Auto-Updater: Initial sync with repository...\x1b[0m');
            const tempDir = await this.downloadUpdatesSilent();
            const changes = await this.compareFiles(tempDir);
            
            if (changes.length > 0) {
                await this.applyChanges(tempDir, changes);
                const updated = changes.filter(c => c.type === 'UPDATED').length;
                const added = changes.filter(c => c.type === 'NEW').length;
                const deleted = changes.filter(c => c.type === 'DELETED').length;
                console.log(`\x1b[32m✅ Auto-Updater: Initial sync complete: ${updated} updated, ${added} added, ${deleted} deleted\x1b[0m`);
            } else {
                console.log('\x1b[36m✅ Auto-Updater: Already up to date\x11b[0m');
            }
            
            this.lastCommit = await this.getLatestCommitSilent();
            this.cleanupTemp(tempDir);
        } catch (error) {
            console.log(`\x1b[33m⚠️  Auto-Updater: Full sync failed: ${error.message}\x1b[0m`);
        }
    }
    
    async compareFiles(tempDir) {
        const changes = [];
        const repoFiles = this.getAllFiles(tempDir);
        const repoFileSet = new Set();
        
        // Check files in repository
        for (const repoFile of repoFiles) {
            const relativePath = path.relative(tempDir, repoFile);
            if (this.shouldIgnore(relativePath)) continue;
            
            repoFileSet.add(relativePath);
            const targetPath = path.join(__dirname, relativePath);
            
            const isProtected = this.isProtectedFile(relativePath);
            
            try {
                const repoContent = fs.readFileSync(repoFile);
                const repoHash = crypto.createHash('sha256').update(repoContent).digest('hex');
                
                if (fs.existsSync(targetPath)) {
                    if (isProtected) {
                        // For protected files, check if they're different
                        const localContent = fs.readFileSync(targetPath);
                        const localHash = crypto.createHash('sha256').update(localContent).digest('hex');
                        
                        if (repoHash !== localHash) {
                            changes.push({
                                file: relativePath,
                                type: 'PROTECTED_CHANGED',
                                path: targetPath,
                                repoContent: repoContent.toString(),
                                repoHash: repoHash
                            });
                        }
                    } else {
                        const localContent = fs.readFileSync(targetPath);
                        const localHash = crypto.createHash('sha256').update(localContent).digest('hex');
                        
                        if (repoHash !== localHash) {
                            changes.push({
                                file: relativePath,
                                type: 'UPDATED',
                                path: targetPath
                            });
                        }
                    }
                } else {
                    changes.push({
                        file: relativePath,
                        type: 'NEW',
                        path: targetPath
                    });
                }
            } catch {}
        }
        
        // Check for deleted files
        const localFiles = this.getAllFiles(__dirname);
        for (const localFile of localFiles) {
            const relativePath = path.relative(__dirname, localFile);
            
            if (this.shouldIgnore(relativePath)) continue;
            if (relativePath.startsWith('.update_temp_')) continue;
            if (this.isProtectedFile(relativePath)) continue;
            
            if (!repoFileSet.has(relativePath)) {
                changes.push({
                    file: relativePath,
                    type: 'DELETED',
                    path: localFile
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
                        
                        if (require.cache[localPath]) {
                            delete require.cache[localPath];
                        }
                        break;
                        
                    case 'PROTECTED_CHANGED':
                        // For protected files, merge intelligently
                        await this.mergeProtectedFile(localPath, change.repoContent);
                        break;
                        
                    case 'DELETED':
                        if (fs.existsSync(localPath)) {
                            fs.unlinkSync(localPath);
                            this.fileHashes.delete(change.file);
                            this.removeEmptyDirs(path.dirname(localPath));
                            
                            if (require.cache[localPath]) {
                                delete require.cache[localPath];
                            }
                        }
                        break;
                }
            } catch {}
        }
    }
    
    async mergeProtectedFile(localPath, repoContent) {
        try {
            const localContent = fs.readFileSync(localPath, 'utf8');
            const repoContentStr = repoContent.toString();
            
            // Check if global.allowUpdates is in local content
            if (localContent.includes('global.allowUpdates')) {
                // Preserve local allowUpdates setting
                const localMatch = localContent.match(/global\.allowUpdates\s*=\s*(.*?);/);
                const repoMatch = repoContentStr.match(/global\.allowUpdates\s*=\s*(.*?);/);
                
                if (localMatch && repoMatch) {
                    // Keep local allowUpdates value
                    const mergedContent = repoContentStr.replace(
                        /global\.allowUpdates\s*=\s*.*?;/,
                        `global.allowUpdates = ${localMatch[1]};`
                    );
                    
                    fs.writeFileSync(localPath, mergedContent);
                    console.log(`\x1b[36m🔄 Merged ${path.basename(localPath)} preserving user settings\x1b[0m`);
                    
                    // Update hash
                    const hash = crypto.createHash('sha256').update(mergedContent).digest('hex');
                    this.fileHashes.set(path.relative(__dirname, localPath), hash);
                    
                    if (require.cache[localPath]) {
                        delete require.cache[localPath];
                    }
                    return;
                }
            }
            
            // If no special handling needed, use repo version
            fs.writeFileSync(localPath, repoContentStr);
            
        } catch (error) {
            console.log(`\x1b[33m⚠️  Error merging ${path.basename(localPath)}: ${error.message}\x1b[0m`);
        }
    }
    
    isProtectedFile(filePath) {
        return this.protectedFiles.some(pattern => {
            if (pattern.endsWith('/')) {
                return filePath.startsWith(pattern);
            }
            return filePath === pattern;
        });
    }
    
    reloadModifiedModules(changes) {
        const modifiedFiles = changes.filter(c => 
            c.type === 'UPDATED' || c.type === 'NEW' || c.type === 'PROTECTED_CHANGED'
        );
        
        for (const change of modifiedFiles) {
            const filePath = change.path;
            
            if (!fs.existsSync(filePath)) continue;
            
            const ext = path.extname(filePath);
            
            if (ext === '.js' || ext === '.cjs' || ext === '.mjs') {
                try {
                    const resolvedPath = require.resolve(filePath);
                    delete require.cache[resolvedPath];
                    this.clearParentCaches(filePath);
                } catch {}
            }
        }
        
        console.log('\x1b[36m🔄 Auto-Updater: Modules reloaded\x1b[0m');
    }
    
    clearParentCaches(filePath) {
        let currentDir = path.dirname(filePath);
        const rootDir = __dirname;
        
        while (currentDir && currentDir !== path.dirname(rootDir)) {
            const cacheKey = currentDir + path.sep;
            
            Object.keys(require.cache).forEach(key => {
                if (key.startsWith(cacheKey)) {
                    delete require.cache[key];
                }
            });
            
            if (currentDir === rootDir) break;
            currentDir = path.dirname(currentDir);
        }
    }
    
    async getLatestCommitSilent() {
        return new Promise((resolve) => {
            const options = {
                hostname: 'api.github.com',
                path: `/repos/${this.repo}/commits/${this.branch}`,
                headers: {
                    'User-Agent': 'CYPHERS-AutoUpdater',
                    'Accept': 'application/vnd.github.v3+json'
                },
                timeout: 10000
            };
            
            // First try local git
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
                                resolve(Date.now().toString());
                            }
                        } else {
                            resolve(Date.now().toString());
                        }
                    });
                });
                
                req.on('error', () => {
                    resolve(Date.now().toString());
                });
                
                req.on('timeout', () => {
                    req.destroy();
                    resolve(Date.now().toString());
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
            
            // First try git pull
            exec('git pull origin ' + this.branch, { cwd: __dirname }, (error) => {
                if (!error) {
                    fs.mkdirSync(tempDir, { recursive: true });
                    this.copyDirectory(__dirname, tempDir);
                    resolve(tempDir);
                    return;
                }
                
                // Fallback to git clone
                const cmd = `git clone --depth 1 --single-branch --branch ${this.branch} ${this.repoUrl} "${tempDir}"`;
                
                exec(cmd, { timeout: 30000 }, (error) => {
                    if (error) {
                        reject(error);
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
                return filePath.startsWith(pattern);
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
