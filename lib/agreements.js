const fs = require('fs');
const path = require('path');
const readline = require('readline');

// Simple color function
function color(text, colorName = 'reset') {
    const colors = {
        'reset': '\x1b[0m',
        'black': '\x1b[30m',
        'red': '\x1b[31m',
        'green': '\x1b[32m',
        'yellow': '\x1b[33m',
        'blue': '\x1b[34m',
        'magenta': '\x1b[35m',
        'cyan': '\x1b[36m',
        'white': '\x1b[37m',
        'brightBlack': '\x1b[90m',
        'brightRed': '\x1b[91m',
        'brightGreen': '\x1b[92m',
        'brightYellow': '\x1b[93m',
        'brightBlue': '\x1b[94m',
        'brightMagenta': '\x1b[95m',
        'brightCyan': '\x1b[96m',
        'brightWhite': '\x1b[97m',
    };
    return (colors[colorName] || colors.reset) + text + colors.reset;
}

// Improved non-blocking typewriter effect
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

// Type text with color
async function typeColor(text, colorName = 'white', speed = 1) {
    const coloredText = color(text, colorName);
    await typeText(coloredText, speed);
}

// Display banner with smooth typing effect
async function displayBotBanner(title = "CYPHERS-v2", showCredits = true) {
    console.clear();
    
    // CYPHERS ASCII Art lines
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
    // Display all banner lines without waiting between lines (faster)
    for (let i = 0; i < bannerLines.length; i++) {
        // Show each line instantly since ASCII art should appear together
        console.log(lineColors[i] + bannerLines[i] + '\x1b[0m');
    }
    
    if (showCredits) {
        console.log();
        await typeColor('┌──────────────────────────────────────────────────────────┐', 'cyan', 2);
        await typeColor('│                    PROJECT INFO                          │', 'cyan', 2);
        await typeColor('└──────────────────────────────────────────────────────────┘', 'cyan', 2);
        console.log();
        await typeColor('   👨‍💻 Author: ', 'cyan', 2);
        await typeText('\x1b[96mcybercyphers\x1b[0m', 1);
        await typeColor('   📦 Repository: ', 'cyan', 2);
        await typeText('\x1b[96mcybercyphers/cyphers-v2\x1b[0m', 1);
        await typeColor('   ⚡ Version: ', 'cyan', 2);
        await typeText('\x1b[96mv2.0\x1b[0m', 1);
        await typeColor('   📅 Copyright: ', 'cyan', 2);
        await typeText('\x1b[96m© 2026 cybercyphers\x1b[0m', 1);
        console.log();
    }
    
    console.log();
}

// Simple question function
const simpleQuestion = (text) => {
    const rl = readline.createInterface({ 
        input: process.stdin, 
        output: process.stdout 
    });
    
    return new Promise((resolve) => { 
        rl.question(text, (answer) => {
            rl.close();
            resolve(answer);
        });
    });
};

// Update config file - ONLY updates the global.allowUpdates value
function updateConfigFile(enableAutoUpdate) {
    try {
        const configPath = path.join(__dirname, './settings/config.js');
        
        let configContent = '';
        if (fs.existsSync(configPath)) {
            configContent = fs.readFileSync(configPath, 'utf8');
        }
        
        if (configContent.includes('global.allowUpdates')) {
            // Update existing global.allowUpdates line
            configContent = configContent.replace(
                /global\.allowUpdates\s*=\s*(true|false)/,
                `global.allowUpdates = ${enableAutoUpdate}`
            );
        } else {
            // Add global.allowUpdates at the beginning if it doesn't exist
            configContent = `global.allowUpdates = ${enableAutoUpdate};\n` + configContent;
        }
        
        fs.writeFileSync(configPath, configContent);
        
        delete require.cache[require.resolve(configPath)];
        require(configPath);
        
        return true;
    } catch (error) {
        console.log(color(`✗ Failed to update config: ${error.message}`, 'red'));
        return false;
    }
}

// Ask yes/no question with typing effect
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

// Sleep function for delays
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Main function to get user agreement
async function getUserAgreement() {
    // Display initial banner
    await displayBotBanner("CYPHERS-v4 SETUP", true);
    
    await sleep(300);
    
    // Type setup section with smooth typing
    await typeColor('╔══════════════════════════════════════════════════════════╗', 'yellow', 3);
    await typeColor('║                    INITIAL SETUP                         ║', 'yellow', 3);
    await typeColor('╚══════════════════════════════════════════════════════════╝', 'yellow', 3);
    console.log();
    
    await typeColor('🔧 This will configure automatic updates for your bot.', 'cyan', 20);
    console.log();
    await typeColor('   Updates will keep your bot secure and add new features.', 'cyan', 20);
    console.log();
    await typeColor('   Updates come from the official cybercyphers repository.', 'cyan', 20);
    console.log();
    
    await typeColor('┌──────────────────────────────────────────────────────────┐', 'magenta', 3);
    await typeColor('│           CONFIGURE AUTO-UPDATES                        │', 'magenta', 3);
    await typeColor('└──────────────────────────────────────────────────────────┘', 'magenta', 3);
    console.log();
    
    // Ask the question
    const enableAutoUpdate = await askYesNoQuestion();
    
    // Save to config exactly
    updateConfigFile(enableAutoUpdate);
    
    // Clear and show art again
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
        `║                 ${"CYPHERS-v4".padEnd(38)}║`,
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
    await typeColor('│               SETTINGS SAVED                            │', 'green', 3);
    await typeColor('└──────────────────────────────────────────────────────────┘', 'green', 3);
    console.log();
    
    if (enableAutoUpdate) {
        await typeColor('   ✅ Auto-update: ', 'green', 20);
        await typeText('\x1b[92mENABLED\x1b[0m', 15);
        console.log();
        await typeColor('   📦 Updates from: ', 'cyan', 20);
        await typeText('\x1b[96mcybercyphers/cyphers-v2\x1b[0m', 15);
        console.log();
        await typeColor('   🔄 Updates will be applied in real-time', 'cyan', 20);
        console.log();
        await typeColor('   🔐 Repository: https://github.com/cybercyphers/cyphers-v2', 'blue', 20);
    } else {
        await typeColor('   ⚠️  Auto-update: ', 'yellow', 20);
        await typeText('\x1b[93mDISABLED\x1b[0m', 15);
        console.log();
        await typeColor('   🔒 Your bot will not check for updates automatically', 'cyan', 20);
        console.log();
        await typeColor('   📝 You can update manually when needed', 'cyan', 20);
        console.log();
        await typeColor('   🌐 Repository: https://github.com/cybercyphers/cyphers-v2', 'blue', 20);
    }
    
    console.log();
    await typeColor('   👨‍💻 Main Author: ', 'cyan', 20);
    await typeText('\x1b[96mcybercyphers\x1b[0m', 15);
    console.log();
    await typeColor('   📅 Copyright: ', 'cyan', 20);
    await typeText('\x1b[96m© 2026 cybercyphers\x1b[0m', 15);
    console.log();
    await typeColor('   ℹ️  You can change this in ./settings/config.js', 'blue', 20);
    console.log();
    
    // Show redirecting message
    await typeColor('✅ Agreement saved, redirecting to CYPHERS-v4...', 'green', 25);
    console.log();
    
    return enableAutoUpdate;
}

// Main export that runs the setup
module.exports = {
    displayBotBanner,
    getUserAgreement,
    simpleQuestion,
    updateConfigFile,
    askYesNoQuestion,
    typeText,
    typeColor,
    color,
    sleep,
    
    // Main function to run the entire setup
    async runSetup() {
        const result = await getUserAgreement();
        
        // After setup is complete, return control to main file
        console.log(color('🎯 Setup complete! Starting main bot...', 'cyan'));
        
        return result;
    }
};