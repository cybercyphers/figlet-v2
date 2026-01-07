const os = require('os');
const fs = require('fs');
const path = require('path');

function formatUptime(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  return `${hours}h ${minutes}m ${secs}s`;
}

function getRAMUsage() {
  const totalRAM = os.totalmem() / (1024 * 1024 * 1024);
  const freeRAM = os.freemem() / (1024 * 1024 * 1024);
  const usedRAM = totalRAM - freeRAM;
  const usagePercent = ((usedRAM / totalRAM) * 100).toFixed(1);
  return `${usedRAM.toFixed(1)}/${totalRAM.toFixed(1)}GB (${usagePercent}%)`;
}

function getProcessMemory() {
  const usage = process.memoryUsage();
  return (usage.rss / (1024 * 1024)).toFixed(2) + ' MB';
}

// Function to check plugins folder in real-time
function getPluginCommands() {
  const pluginsDir = path.join(__dirname, '../plugins');
  const categories = {};
  
  if (!fs.existsSync(pluginsDir)) {
    return categories;
  }
  
  const pluginFiles = fs.readdirSync(pluginsDir).filter(file => 
    file.endsWith('.js') || file.endsWith('.cjs')
  );
  
  for (const file of pluginFiles) {
    try {
      const pluginPath = path.join(pluginsDir, file);
      
      // Clear cache and load fresh every time
      delete require.cache[require.resolve(pluginPath)];
      const plugin = require(pluginPath);
      
      if (plugin.name && plugin.execute) {
        const category = plugin.category || 'GENERAL';
        
        if (!categories[category]) {
          categories[category] = [];
        }
        
        // Check if command already exists in category
        const exists = categories[category].some(cmd => cmd.name === plugin.name);
        if (!exists) {
          categories[category].push({
            name: plugin.name,
            description: plugin.description || 'No description'
          });
        }
      }
    } catch (error) {
      // Skip if can't load
      continue;
    }
  }
  
  // Sort categories alphabetically
  const sortedCategories = {};
  Object.keys(categories).sort().forEach(key => {
    sortedCategories[key] = categories[key];
  });
  
  return sortedCategories;
}

async function getBotStats(sock, msg) {
  // Get current time and date
  const now = new Date();
  const time = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
  const day = now.toLocaleDateString('en-US', { weekday: 'long' });
  const date = now.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });
  
  // Get plugins count by checking plugins directory
  const pluginsDir = path.join(__dirname, '../plugins');
  let pluginsCount = 0;
  if (fs.existsSync(pluginsDir)) {
    pluginsCount = fs.readdirSync(pluginsDir).filter(file => 
      file.endsWith('.js') || file.endsWith('.cjs')
    ).length;
  }
  
  // Bot statistics
  const botVersion = '2.0.0';
  const ramUsage = getRAMUsage();
  const platform = os.platform();
  const uptime = formatUptime(process.uptime());
  const nodeVersion = process.version;
  const processMemory = getProcessMemory();
  const cpuCores = os.cpus().length;
  const cpuModel = os.cpus()[0].model;

  let menuText = `╭───「 🔮 CYPHERS-V2 STATS 」───⊷
│ ┌──────────────
│ │ 👤 User : ${msg.pushName || 'User'}
│ │ 🕐 Time : ${time}
│ │ 📅 Date : ${date}
│ │ 📍 Day : ${day}
│ ├──────────────
│ │ 🔧 Version : ${botVersion}
│ │ 📦 Plugins : ${pluginsCount}
│ │ 🖥️ Platform : ${platform}
│ │ ⚡ Node.js : ${nodeVersion}
│ ├──────────────
│ │ 💾 RAM Usage : ${ramUsage}
│ │ 🧠 Process : ${processMemory}
│ │ 🔄 Uptime : ${uptime}
│ │ 🎯 CPU : ${cpuCores} cores | ${cpuModel}
│ └──────────────
╰────────────────────────────⊷\n\n`

  // Get plugin commands in real-time
  const pluginCommands = getPluginCommands();
  const prefix = global.prefix || '.';
  
  // Display commands by category
  for (const [category, commands] of Object.entries(pluginCommands)) {
    if (commands.length > 0) {
      menuText += `╭─「 ${category.toUpperCase()} 」\n`;
      
      // Sort commands alphabetically
      commands.sort((a, b) => a.name.localeCompare(b.name))
        .forEach(cmd => {
          menuText += `│ ${prefix}${cmd.name} - ${cmd.description}\n`;
        });
      
      menuText += '╰─────────────────────\n\n';
    }
  }
  
  // If no plugins found, show default commands
  if (Object.keys(pluginCommands).length === 0) {
    menuText += '╭─「 📋 DEFAULT COMMANDS 」\n';
    menuText += '│ .menu - Show this menu\n';
    menuText += '│ .help - Get help\n';
    menuText += '│ .ping - Check bot response time\n';
    menuText += '╰─────────────────────\n\n';
  }
  
  // Usage Tips
  menuText += '╭─「 💡 USAGE TIPS 」\n';
  menuText += '│ • Prefix: ' + prefix + '\n';
  menuText += '│ • Use .help for detailed help\n';
  menuText += '╰─────────────────────\n\n';
  
  menuText += '👑 Global Owner: Am All(CYBERCYPHERS)\n';
  menuText += 'Enjoy more coming soon ⚡️';

  return menuText;
}

module.exports = {
  getBotStats,
  formatUptime,
  getRAMUsage,
  getProcessMemory,
  getPluginCommands
};
