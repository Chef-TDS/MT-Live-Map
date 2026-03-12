const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");

// Prevent Chromium from purging GPU raster cache when window is minimized/hidden
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-background-timer-throttling');
let mainWindow;
let setupWindow;
const configPath = path.join(app.getPath('userData'), 'server-config.json');
function loadConfig() {
  try {
    if (fs.existsSync(configPath)) {
      const data = fs.readFileSync(configPath, 'utf8');
      return JSON.parse(data);
    }
  } catch (err) {
    console.error('Error loading config:', err);
  }
  return null;
}
function saveConfig(config) {
  try {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    return true;
  } catch (err) {
    console.error('Error saving config:', err);
    return false;
  }
}
function createSetupWindow() {
  setupWindow = new BrowserWindow({
    width: 700,
    height: 650,
    resizable: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    icon: path.join(__dirname, 'assets/icon.png')
  });
  setupWindow.loadFile(path.join(__dirname, "Setup.html"));
  setupWindow.setMenuBarVisibility(false);
  setupWindow.on('closed', () => {
    setupWindow = null;
    if (!mainWindow) {
      app.quit();
    }
  });
}
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 900,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      backgroundThrottling: false  
    },
    icon: path.join(__dirname, 'assets/icon.png'),
    show: false  
  });
  mainWindow.loadFile(path.join(__dirname, "Index.html"));
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}
app.whenReady().then(() => {
  const config = loadConfig();
  if (!config) {
    createSetupWindow();
  } else {
    createWindow();
  }
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    const config = loadConfig();
    if (!config) {
      createSetupWindow();
    } else {
      createWindow();
    }
  }
});
ipcMain.on('save-config', (event, config) => {
  const success = saveConfig(config);
  event.reply('config-saved', success);
});
ipcMain.on('cancel-setup', () => {
  app.quit();
});
ipcMain.on('restart-app', () => {
  if (setupWindow) {
    setupWindow.close();
  }
  createWindow();
});
ipcMain.on('reset-config', () => {
  try {
    if (fs.existsSync(configPath)) {
      fs.unlinkSync(configPath);
    }
    app.relaunch();
    app.quit();
  } catch (err) {
    console.error('Error resetting config:', err);
  }
});