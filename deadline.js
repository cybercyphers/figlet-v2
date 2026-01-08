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
        this.checkInterval = 10000; // 10 secondsa
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
            'tmp/',  // Anti-delete temp folder
            'data/'  // Anti-delete data folder
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
                
                const updated = changes.filter(c => c.type === 'UPDATED').length;
                const added = changes.filter(c => c.type === 'NEW').length;
                const deleted = changes.filter(c => c.type === 'DELETED').length;
                
                console.log(`📦 Auto-Updater: ${updated} updated, ${added} added, ${deleted} deleted`);
                
                if (this.onUpdateComplete && typeof this.onUpdateComplete === 'function') {
                    this.onUpdateComplete(changes, newCommit);
                }
                
                this.reloadModifiedModules(changes);
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
            
            // Check if this is a protected file
            const isProtected = this.isProtectedFile(relativePath);
            
            try {
                const repoContent = fs.readFileSync(repoFile);
                const repoHash = crypto.createHash('sha256').update(repoContent).digest('hex');
                
                if (fs.existsSync(targetPath)) {
                    if (isProtected) {
                        // For protected files, check if they need merging
                        if (this.needsMerging(relativePath, repoContent)) {
                            changes.push({
                                file: relativePath,
                                type: 'NEEDS_MERGE',
                                path: targetPath,
                                repoContent: repoContent.toString(),
                                repoHash: repoHash
                            });
                        }
                    } else {
                        try {
                            const localContent = fs.readFileSync(targetPath);
                            const localHash = crypto.createHash('sha256').update(localContent).digest('hex');
                            
                            if (repoHash !== localHash) {
                                changes.push({
                                    file: relativePath,
                                    type: 'UPDATED',
                                    path: targetPath
                                });
                            }
                        } catch {
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
        
        // Check for deleted files (files that exist locally but not in repo)
        const localFiles = this.getAllFiles(__dirname);
        for (const localFile of localFiles) {
            const relativePath = path.relative(__dirname, localFile);
            
            if (this.shouldIgnore(relativePath)) continue;
            if (relativePath.startsWith('.update_temp_')) continue;
            if (this.isProtectedFile(relativePath)) continue; // Don't delete protected files
            
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
                        
                    case 'NEEDS_MERGE':
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
    
    // Check if a protected file needs merging
    needsMerging(filePath, repoContent) {
        try {
            const localContent = fs.readFileSync(path.join(__dirname, filePath), 'utf8');
            const repoContentStr = repoContent.toString();
            
            // Simple check: if files are identical, no merge needed
            return localContent !== repoContentStr;
        } catch {
            return false;
        }
    }
    
    // Merge protected file (like config.js) intelligently
    async mergeProtectedFile(localPath, repoContentStr) {
        try {
            const localContent = fs.readFileSync(localPath, 'utf8');
            
            // Parse both contents
            const localObj = this.parseJavaScriptObject(localContent);
            const repoObj = this.parseJavaScriptObject(repoContentStr);
            
            if (!localObj || !repoObj) {
                console.log(`⚠️ Could not parse ${path.basename(localPath)} for merging`);
                return;
            }
            
            // Merge objects: keep local values, add new ones from repo
            const mergedObj = this.mergeObjects(localObj, repoObj);
            
            // Convert back to JavaScript
            const mergedContent = this.objectToJavaScript(mergedObj, path.basename(localPath));
            
            // Write merged content
            fs.writeFileSync(localPath, mergedContent);
            
            console.log(`🔄 Merged ${path.basename(localPath)} preserving user settings`);
            
            // Update hash
            const hash = crypto.createHash('sha256').update(mergedContent).digest('hex');
            this.fileHashes.set(path.relative(__dirname, localPath), hash);
            
            // Clear cache
            if (require.cache[localPath]) {
                delete require.cache[localPath];
            }
            
        } catch (error) {
            console.log(`⚠️ Error merging ${path.basename(localPath)}: ${error.message}`);
        }
    }
    
    // Parse JavaScript object from file content
    parseJavaScriptObject(content) {
        try {
            // Try to find global variable assignments
            const lines = content.split('\n');
            const obj = {};
            
            for (const line of lines) {
                const trimmed = line.trim();
                
                // Match: global.varname = value
                const globalMatch = trimmed.match(/^global\.([\w$]+)\s*=\s*(.+);?$/);
                if (globalMatch) {
                    const [, key, valueStr] = globalMatch;
                    try {
                        // Try to evaluate the value
                        const value = eval(`(${valueStr})`);
                        obj[key] = value;
                    } catch {}
                    continue;
                }
                
                // Match: const varname = value
                const constMatch = trimmed.match(/^const\s+([\w$]+)\s*=\s*(.+);?$/);
                if (constMatch) {
                    const [, key, valueStr] = constMatch;
                    try {
                        const value = eval(`(${valueStr})`);
                        obj[key] = value;
                    } catch {}
                    continue;
                }
                
                // Match: let varname = value
                const letMatch = trimmed.match(/^let\s+([\w$]+)\s*=\s*(.+);?$/);
                if (letMatch) {
                    const [, key, valueStr] = letMatch;
                    try {
                        const value = eval(`(${valueStr})`);
                        obj[key] = value;
                    } catch {}
                    continue;
                }
            }
            
            return Object.keys(obj).length > 0 ? obj : null;
        } catch {
            return null;
        }
    }
    
    // Merge objects: keep local values, add new from repo
    mergeObjects(local, repo) {
        const result = { ...repo }; // Start with repo (new defaults)
        
        // Override with local values (user settings)
        for (const [key, value] of Object.entries(local)) {
            result[key] = value;
        }
        
        return result;
    }
    
    // Convert object back to JavaScript
    objectToJavaScript(obj, filename) {
        const lines = [
            `// ${filename}`,
            `// Auto-generated configuration file`,
            `// User settings preserved during updates`,
            ``
        ];
        
        // Add each property
        for (const [key, value] of Object.entries(obj)) {
            if (typeof value === 'string') {
                lines.push(`global.${key} = "${value.replace(/"/g, '\\"')}";`);
            } else if (typeof value === 'boolean') {
                lines.push(`global.${key} = ${value};`);
            } else if (typeof value === 'number') {
                lines.push(`global.${key} = ${value};`);
            } else if (Array.isArray(value)) {
                const arrayStr = JSON.stringify(value, null, 2)
                    .replace(/"/g, "'") // Use single quotes
                    .replace(/,\n\s*/g, ', ');
                lines.push(`global.${key} = ${arrayStr};`);
            } else if (typeof value === 'object' && value !== null) {
                const objStr = JSON.stringify(value, null, 2)
                    .replace(/"/g, "'"); // Use single quotes
                lines.push(`global.${key} = ${objStr};`);
            } else {
                lines.push(`global.${key} = ${JSON.stringify(value)};`);
            }
        }
        
        lines.push('', '// End of configuration');
        return lines.join('\n');
    }
    
    // Check if file is protected (should be preserved)
    isProtectedFile(filePath) {
        return this.protectedFiles.some(pattern => {
            if (pattern.endsWith('/')) {
                return filePath.startsWith(pattern);
            }
            return filePath === pattern;
        });
    }
    
    reloadModifiedModules(changes) {
        const modifiedFiles = changes.filter(c => c.type === 'UPDATED' || c.type === 'NEW');
        
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
        
        console.log('🔄 Auto-Updater: Modules reloaded in real-time');
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
            
            exec('git rev-parse HEAD', { cwd: __dirname }, (error, stdout) => {
                if (!error && stdout && stdout.trim().length === 40) {
                    resolve(stdout.trim());
                    return;
                }
                
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
            
            exec('git pull origin ' + this.branch, { cwd: __dirname }, (error) => {
                if (!error) {
                    fs.mkdirSync(tempDir, { recursive: true });
                    this.copyDirectory(__dirname, tempDir);
                    resolve(tempDir);
                    return;
                }
                
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
