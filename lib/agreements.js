const fs = require('fs');
const path = require('path');
const readline = require('readline');
//clear
// Color function for console output
function color(text, colorName = 'reset') {
    const colors = {
        'reset': '\x1b[0m',
        'red': '\x1b[31m',
        'green': '\x1b[32m',
        'yellow': '\x1b[33m',
        'blue': '\x1b[34m',
        'magenta': '\x1b[35m',
        'cyan': '\x1b[36m',
        'white': '\x1b[37m',
        'brightGreen': '\x1b[92m',
        'brightCyan': '\x1b[96m',
    };
    return (colors[colorName] || colors.reset) + text + colors.reset;
}

// Safe config parser (NO eval)
function safeParseConfigValue(valueStr) {
    try {
        const trimmed = valueStr.trim();
        
        // Handle booleans
        if (trimmed === 'true') return true;
        if (trimmed === 'false') return false;
        if (trimmed === '_') return '_';
        
        // Handle numbers
        if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
            return parseFloat(trimmed);
        }
        
        // Handle strings with quotes
        if ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
            (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
            return trimmed.slice(1, -1);
        }
        
        // Return as string
        return trimmed;
    } catch {
        return valueStr;
    }
}

// Check config for global.allowUpdates
function checkConfigForAllowUpdates() {
    try {
        const configPath = path.join(__dirname, '../settings/config.js');
        
        if (!fs.existsSync(configPath)) {
            return '_'; // Config doesn't exist
        }
        
        const configContent = fs.readFileSync(configPath, 'utf8');
        const lines = configContent.split('\n');
        
        for (const line of lines) {
            const trimmed = line.trim();
            
            // Look for global.allowUpdates = value
            if (trimmed.includes('global.allowUpdates')) {
                const match = trimmed.match(/global\.allowUpdates\s*=\s*(.*?);/);
                if (match) {
                    const value = safeParseConfigValue(match[1]);
                    return value;
                }
            }
        }
        
        return '_'; // Not found
    } catch (error) {
        console.log(color('⚠️  Could not read config file', 'yellow'));
        return '_';
    }
}

// Update config file
function updateConfigFile(enableAutoUpdate) {
    try {
        const configPath = path.join(__dirname, '../settings/config.js');
        
        if (!fs.existsSync(configPath)) {
            // Create basic config if it doesn't exist
            const basicConfig = `// CYPHERS-v2 Configuration
global.allowUpdates = ${enableAutoUpdate};
global.prefix = '.';
global.owner = []; // Add your WhatsApp number here
global.status = true; // true = public, false = private`;
            
            const dir = path.dirname(configPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(configPath, basicConfig);
            return true;
        }
        
        let configContent = fs.readFileSync(configPath, 'utf8');
        
        if (configContent.includes('global.allowUpdates')) {
            // Replace existing
            configContent = configContent.replace(
                /global\.allowUpdates\s*=\s*.*;/,
                `global.allowUpdates = ${enableAutoUpdate};`
            );
        } else {
            // Add at beginning
            configContent = `global.allowUpdates = ${enableAutoUpdate};\n${configContent}`;
        }
        
        fs.writeFileSync(configPath, configContent);
        return true;
    } catch (error) {
        console.log(color(`✗ Failed to update config: ${error.message}`, 'red'));
        return false;
    }
}

// Display banner
async function displayBotBanner(title = "CYPHERS-v2", showCredits = true) {
    console.clear();
    
    const banner = [
        '╔═══════════════════════════════════════════════════════╗',
        '║                                                       ║',
        `║                ${color(title, 'brightCyan')}                      ║`,
        '║                                                       ║',
        '║         ⚡  Auto-Updating WhatsApp Bot  ⚡             ║',
        '║                                                       ║',
        '╚═══════════════════════════════════════════════════════╝',
    ];
    
    console.log(color(banner.join('\n'), 'cyan'));
    
    if (showCredits) {
        console.log();
        console.log(color('👨‍💻 Author: ', 'cyan') + color('cybercyphers', 'brightGreen'));
        console.log(color('📦 Repository: ', 'cyan') + color('cybercyphers/cyphers-v2', 'brightGreen'));
        console.log(color('⚡ Version: ', 'cyan') + color('v2.0', 'brightGreen'));
        console.log();
    }
}

// Ask yes/no question
async function askYesNoQuestion() {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
    
    return new Promise((resolve) => {
        rl.question(color('⚡ Enable automatic updates? (yes/no) [yes]: ', 'cyan'), (response) => {
            rl.close();
            
            const cleanResponse = response.trim().toLowerCase();
            let enableAutoUpdate = true;
            
            if (cleanResponse === 'no' || cleanResponse === 'n') {
                enableAutoUpdate = false;
            } else if (cleanResponse === 'yes' || cleanResponse === 'y' || cleanResponse === '') {
                enableAutoUpdate = true;
            } else {
                console.log(color('❌ Invalid input! Using default (yes)', 'red'));
            }
            
            resolve(enableAutoUpdate);
        });
    });
}

// Main agreement function
async function getUserAgreement() {
    console.clear();
    
    // First check config
    const configStatus = checkConfigForAllowUpdates();
    console.log(color('🔍 Checking configuration...', 'cyan'));
    
    // If config has true/false, return it immediately
    if (configStatus === true || configStatus === false) {
        console.log(color(`✅ Using saved preference: Auto-updates ${configStatus ? 'ENABLED' : 'DISABLED'}`, 'green'));
        await new Promise(resolve => setTimeout(resolve, 1500));
        return configStatus;
    }
    
    // If config has '_' or doesn't exist, show agreement
    console.log(color('📝 First time setup - Agreement required', 'yellow'));
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    // Show banner
    await displayBotBanner("CYPHERS-v2 SETUP", true);
    
    console.log();
    console.log(color('┌──────────────────────────────────────────────────────────┐', 'magenta'));
    console.log(color('│                 AUTO-UPDATE SETTINGS                    │', 'magenta'));
    console.log(color('└──────────────────────────────────────────────────────────┘', 'magenta'));
    console.log();
    
    console.log(color('ℹ️  Automatic updates will:', 'cyan'));
    console.log(color('   • Keep your bot secure and up-to-date', 'white'));
    console.log(color('   • Add new features automatically', 'white'));
    console.log(color('   • Apply bug fixes in real-time', 'white'));
    console.log();
    console.log(color('📦 Updates come from: cybercyphers/cyphers-v2', 'brightCyan'));
    console.log();
    
    // Ask question
    const enableAutoUpdate = await askYesNoQuestion();
    
    // Save to config
    updateConfigFile(enableAutoUpdate);
    
    // Show result
    console.clear();
    await displayBotBanner("CYPHERS-v2", false);
    
    console.log();
    console.log(color('┌──────────────────────────────────────────────────────────┐', 'green'));
    console.log(color('│                    SETUP COMPLETE                        │', 'green'));
    console.log(color('└──────────────────────────────────────────────────────────┘', 'green'));
    console.log();
    
    if (enableAutoUpdate) {
        console.log(color('✅ Auto-updates: ', 'green') + color('ENABLED', 'brightGreen'));
        console.log(color('   🔄 Checking for updates every 30 seconds', 'cyan'));
        console.log(color('   📡 Repository: https://github.com/cybercyphers/cyphers-v2', 'cyan'));
    } else {
        console.log(color('⚠️  Auto-updates: ', 'yellow') + color('DISABLED', 'brightYellow'));
        console.log(color('   🔒 Updates will not be checked automatically', 'cyan'));
        console.log(color('   📝 You can update manually when needed', 'cyan'));
    }
    
    console.log();
    console.log(color('📁 Config file: ./settings/config.js', 'blue'));
    console.log(color('   You can change auto-update settings there', 'blue'));
    console.log();
    console.log(color('🎯 Starting CYPHERS-v2...', 'brightGreen'));
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    return enableAutoUpdate;
}

module.exports = {
    displayBotBanner,
    getUserAgreement,
    checkConfigForAllowUpdates,
    updateConfigFile,
    
    // Main function
    async runSetup() {
        return await getUserAgreement();
    }
};
