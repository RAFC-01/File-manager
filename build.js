const { app, BrowserWindow } = require('electron');
const path = require('path');

const devMode = true;

if (devMode) require('electron-reload')(__dirname, {ignored: [path.join(__dirname, '*.db')]});

const mainPath = path.join(__dirname, 'client', 'index.html');

const createWindow = () => {
    const win = new BrowserWindow({
      width: 1400,
      height: 720,
      backgroundColor: 'black',
      // autoHideMenuBar: true,
      webPreferences: {
        // offscreen: true,
        nodeIntegration: true,
        contextIsolation: false,
        nodeIntegrationInWorker: true,
      }  
    })
  
    win.loadFile(mainPath);
    win.removeMenu();

    if (devMode){
      win.webContents.openDevTools();
    }
    // win.setFullScreen(true);
  }

app.whenReady().then(() => {
    createWindow();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
});