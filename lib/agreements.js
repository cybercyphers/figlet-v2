const fs = require('fs');
const path = require('path');
const readline = require('readline');

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

// Improved non-blocking typewriter effect - FROM SECOND FILE
async function typeText(text, speed = 1) {
    return new Promise((resolve) => {
        let i = 0;
        const typeChar = () => {
            if (i < text.length) {
                process.stdout.write(text[i]);
                i++;
                setTimeout(typeChar, speed);
            } else {
                process.stdout.write('\n');
                resolve();
            }
        };
        typeChar();
    });
}

// Type text with color - FROM SECOND FILE
async function typeColor(text, colorName = 'white', speed = 1) {
    const coloredText = color(text, colorName);
    await typeText(coloredText, speed);
}

// Sleep function for delays - FROM SECOND FILE
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
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

// Display banner - CYPHERS ASCII ART
async function displayBotBanner(title = "CYPHERS-v2", showCredits = true) {
    console.clear();
    
    // CYPHERS ASCII Art from the other file
    const bannerLines = [
        ' ██████╗██╗   ██╗██████╗ ██╗  ██╗███████╗██████╗ ███████╗',
        '██╔════╝╚██╗ ██╔╝██╔══██╗██║  ██║██╔════╝██╔══██╗██╔════╝',
        '██║      ╚████╔╝ ██████╔╝███████║█████╗  ██████╔╝███████╗',
        '██║       ╚██╔╝  ██╔═══╝ ██╔══██║██╔══╝  ██╔══██╗╚════██║',
        '╚██████╗   ██║   ██║     ██║  ██║███████╗██║  ██║███████║',
        ' ╚═════╝   ╚═╝   ╚═╝     ╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝╚══════╝',
        '╔═══════════════════════════════════════════════════════╗',
        `║                 ${title.padEnd(38)}║`,
        '╚═══════════════════════════════════════════════════════╝'
    ];
    
    const lineColors = ['\x1b[96m', '\x1b[96m', '\x1b[36m', '\x1b[36m', '\x1b[96m', '\x1b[96m', '\x1b[33m', '\x1b[33m', '\x1b[33m'];
    
    console.log(); // Empty line
    // Display all banner lines instantly
    for (let i = 0; i < bannerLines.length; i++) {
        console.log(lineColors[i] + bannerLines[i] + '\x1b[0m');
    }
    
    if (showCredits) {
        console.log();
        await typeColor('┌──────────────────────────────────────────────────────────┐', 'cyan', 2);
        await typeColor('│                    PROJECT INFO                          │', 'cyan', 2);
        await typeColor('└──────────────────────────────────────────────────────────┘', 'cyan', 2);
        console.log();
        await typeColor('   👨‍💻 Author: ', 'cyan', 20);
        await typeText('\x1b[96mcybercyphers\x1b[0m', 15);
        await typeColor('   📦 Repository: ', 'cyan', 20);
        await typeText('\x1b[96mcybercyphers/cyphers-v2\x1b[0m', 15);
        await typeColor('   ⚡ Version: ', 'cyan', 20);
        await typeText('\x1b[96mv2.0\x1b[0m', 15);
        console.log();
    }
    
    console.log();
}

// Ask yes/no question with typing effect - FROM SECOND FILE (WORKING VERSION)
async function askYesNoQuestion() {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
    
    // Type the question character by character
    const questionText = color('⚡ ', 'cyan') + 
                        color('Enable automatic updates? ', 'white') + 
                        color('(yes/no) ', 'yellow') + 
                        color('[yes]: ', 'green');
    
    // Show question typing
    await typeText(questionText, 20);
    
    return new Promise((resolve) => {
        rl.question('', (response) => {
            rl.close();
            
            const cleanResponse = response.trim().toLowerCase();
            let enableAutoUpdate = true; // default to yes
            
            if (cleanResponse === 'no' || cleanResponse === 'n') {
                enableAutoUpdate = false;
            } else if (cleanResponse === 'yes' || cleanResponse === 'y' || cleanResponse === '') {
                enableAutoUpdate = true;
            } else {
                // Invalid input, show error and ask again
                console.log(color('  ❌ Invalid input! Please enter "yes" or "no"', 'red'));
                // Recursively ask again
                askYesNoQuestion().then(resolve);
                return;
            }
            
            resolve(enableAutoUpdate);
        });
    });
}

// Main agreement function with typing animations
async function getUserAgreement() {
    console.clear();
    
    // First check config
    const configStatus = checkConfigForAllowUpdates();
    await typeColor('🔍 Checking configuration...', 'cyan', 20);
    console.log();
    
    // If config has true/false, return it immediately
    if (configStatus === true || configStatus === false) {
        await typeColor(`✅ Using saved preference: Auto-updates ${configStatus ? 'ENABLED' : 'DISABLED'}`, 'green', 20);
        console.log();
        await sleep(1500);
        return configStatus;
    }
    
    // If config has '_' or doesn't exist, show agreement
    await typeColor('📝 First time setup - Agreement required', 'yellow', 20);
    console.log();
    await sleep(1500);
    
    // Show banner
    await displayBotBanner("CYPHERS-v2 SETUP", true);
    
    console.log();
    await typeColor('┌──────────────────────────────────────────────────────────┐', 'magenta', 3);
    await typeColor('│                 AUTO-UPDATE SETTINGS                    │', 'magenta', 3);
    await typeColor('└──────────────────────────────────────────────────────────┘', 'magenta', 3);
    console.log();
    
    await typeColor('ℹ️  Automatic updates will:', 'cyan', 20);
    console.log();
    await typeColor('   • Keep your bot secure and up-to-date', 'white', 15);
    console.log();
    await typeColor('   • Add new features automatically', 'white', 15);
    console.log();
    await typeColor('   • Apply bug fixes in real-time', 'white', 15);
    console.log();
    await typeColor('📦 Updates come from: cybercyphers/cyphers-v2', 'brightCyan', 20);
    console.log();
    
    // Ask question - USING THE WORKING VERSION FROM SECOND FILE
    const enableAutoUpdate = await askYesNoQuestion();
    
    // Save to config
    updateConfigFile(enableAutoUpdate);
    
    // Show result
    console.clear();
    
    // CYPHERS ASCII Art lines (display instantly)
    const bannerLines = [
        ' ██████╗██╗   ██╗██████╗ ██╗  ██╗███████╗██████╗ ███████╗',
        '██╔════╝╚██╗ ██╔╝██╔══██╗██║  ██║██╔════╝██╔══██╗██╔════╝',
        '██║      ╚████╔╝ ██████╔╝███████║█████╗  ██████╔╝███████╗',
        '██║       ╚██╔╝  ██╔═══╝ ██╔══██║██╔══╝  ██╔══██╗╚════██║',
        '╚██████╗   ██║   ██║     ██║  ██║███████╗██║  ██║███████║',
        ' ╚═════╝   ╚═╝   ╚═╝     ╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝╚══════╝',
        '╔═══════════════════════════════════════════════════════╗',
        `║                 ${"CYPHERS-v2".padEnd(38)}║`,
        '╚═══════════════════════════════════════════════════════╝'
    ];
    
    const lineColors = ['\x1b[96m', '\x1b[96m', '\x1b[36m', '\x1b[36m', '\x1b[96m', '\x1b[96m', '\x1b[33m', '\x1b[33m', '\x1b[33m'];
    
    console.log();
    for (let i = 0; i < bannerLines.length; i++) {
        console.log(lineColors[i] + bannerLines[i] + '\x1b[0m');
    }
    console.log();
    
    // Show confirmation with typing effect
    console.log();
    await typeColor('┌──────────────────────────────────────────────────────────┐', 'green', 3);
    await typeColor('│                    SETUP COMPLETE                        │', 'green', 3);
    await typeColor('└──────────────────────────────────────────────────────────┘', 'green', 3);
    console.log();
    
    if (enableAutoUpdate) {
        await typeColor('   ✅ Auto-updates: ', 'green', 20);
        await typeText('\x1b[92mENABLED\x1b[0m', 15);
        console.log();
        await typeColor('   🔄 Checking for updates every 30 seconds', 'cyan', 20);
        console.log();
        await typeColor('   📡 Repository: https://github.com/cybercyphers/cyphers-v2', 'cyan', 20);
    } else {
        await typeColor('   ⚠️  Auto-updates: ', 'yellow', 20);
        await typeText('\x1b[93mDISABLED\x1b[0m', 15);
        console.log();
        await typeColor('   🔒 Updates will not be checked automatically', 'cyan', 20);
        console.log();
        await typeColor('   📝 You can update manually when needed', 'cyan', 20);
    }
    
    console.log();
    await typeColor('📁 Config file: ./settings/config.js', 'blue', 20);
    await typeColor('   You can change auto-update settings there', 'blue', 20);
    console.log();
    await typeColor('🎯 Starting CYPHERS-v2...', 'brightGreen', 25);
    console.log();
    
    await sleep(3000);
    
    return enableAutoUpdate;
}

module.exports = {
    displayBotBanner,
    getUserAgreement,
    checkConfigForAllowUpdates,
    updateConfigFile,
    askYesNoQuestion,
    typeText,
    typeColor,
    sleep,
    
    // Main function
    async runSetup() {
        return await getUserAgreement();
    }
};
