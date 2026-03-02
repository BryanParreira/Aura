const { app, BrowserWindow, ipcMain, desktopCapturer, globalShortcut, shell, Menu, Tray, screen, session, systemPreferences, net, nativeImage, clipboard } = require('electron');
const path = require('path');
const { autoUpdater } = require('electron-updater');
const { exec } = require('child_process');

const isDev = !app.isPackaged;
let win;
let tray = null;

autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

app.commandLine.appendSwitch('disable-gpu-process-crash-limit');
app.commandLine.appendSwitch('disable-renderer-backgrounding');

async function checkMacPermissions() {
  if (process.platform === 'darwin') {
    const status = systemPreferences.getMediaAccessStatus('microphone');
    if (status === 'not-determined') await systemPreferences.askForMediaAccess('microphone');
  }
}

function getIconPath() {
  let iconPath;
  if (isDev) {
    iconPath = process.platform === 'win32' 
      ? path.join(__dirname, '../build/icon.ico') 
      : path.join(__dirname, '../build/icons/16x16.png');
  } else {
    iconPath = process.platform === 'win32'
      ? path.join(process.resourcesPath, 'icon.ico')
      : path.join(process.resourcesPath, 'icon.png');
    if (!require('fs').existsSync(iconPath)) {
        iconPath = path.join(app.getAppPath(), 'build/icon.ico');
    }
  }
  return iconPath;
}

function createTray() {
  const iconPath = getIconPath();
  try {
    const icon = nativeImage.createFromPath(iconPath);
    tray = new Tray(icon);
    const contextMenu = Menu.buildFromTemplate([
      { label: 'Show Aura', click: () => { win.show(); win.webContents.send('app-woke-up'); } },
      { label: 'Hide Aura', click: () => win.hide() },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() }
    ]);
    tray.setToolTip('Aura');
    tray.setContextMenu(contextMenu);
    tray.on('click', () => {
      if (win.isVisible()) win.hide();
      else { win.show(); win.webContents.send('app-woke-up'); }
    });
  } catch (e) { console.log("Tray error:", e); }
}

function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  win = new BrowserWindow({
    width, height, x: 0, y: 0,
    type: 'panel', 
    enableLargerThanScreen: true,
    hasShadow: false,
    alwaysOnTop: true,
    transparent: true,
    frame: false,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      devTools: isDev
    }
  });

  win.setIgnoreMouseEvents(true, { forward: true });
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setContentProtection(true);

  win.on('focus', () => win.setIgnoreMouseEvents(false));

  if (isDev) win.loadURL('http://localhost:5173');
  else win.loadFile(path.join(__dirname, '../dist/index.html'));

  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  session.defaultSession.setPermissionRequestHandler((_, perm, callback) => callback(true));
  
  // STANDARD WAKE UP
  globalShortcut.register('CommandOrControl+Shift+G', () => {
    if (win.isVisible()) win.hide(); 
    else { win.show(); win.setSkipTaskbar(false); win.focus(); win.webContents.send('app-woke-up'); }
  });

  // NEXT-GEN SMART HOOK: Analyze Clipboard & Context
  globalShortcut.register('CommandOrControl+Shift+E', () => {
    if (!win.isVisible()) { win.show(); win.setSkipTaskbar(false); }
    win.focus();
    win.webContents.send('analyze-context');
  });
}

// --- IPC HANDLERS ---
ipcMain.handle('toggle-always-on-top', (e, flag) => {
  if (win) { win.setAlwaysOnTop(flag, 'screen-saver'); win.setSkipTaskbar(flag); }
});

ipcMain.handle('run-command', (e, command) => {
  return new Promise((resolve) => {
    exec(command, (error, stdout, stderr) => {
      resolve({ success: !error, output: stdout || stderr || error?.message });
    });
  });
});

// OS OMNISCIENCE: Get Active App
ipcMain.handle('get-active-context', async () => {
  try {
    const activeWin = (await import('active-win')).default;
    const result = await activeWin();
    return result ? { title: result.title, app: result.owner.name } : null;
  } catch (e) { return null; }
});

ipcMain.handle('get-clipboard', () => clipboard.readText());

ipcMain.handle('proxy-request', async (e, { url, method, headers, body }) => {
  return new Promise((resolve, reject) => {
    const request = net.request({ url, method });
    Object.keys(headers).forEach(k => request.setHeader(k, headers[k]));
    request.on('response', (response) => {
      let data = '';
      response.on('data', (chunk) => data += chunk);
      response.on('end', () => {
        try { resolve({ status: response.statusCode, data: JSON.parse(data) }); } 
        catch { resolve({ status: response.statusCode, data: {} }); }
      });
    });
    request.on('error', reject);
    if (body) request.write(JSON.stringify(body));
    request.end();
  });
});

ipcMain.on('stream-request', (e, { url, method, headers, body, requestId }) => {
  const request = net.request({ url, method });
  Object.keys(headers).forEach(k => request.setHeader(k, headers[k]));
  request.on('response', (res) => {
    res.on('data', (chunk) => { if (!win.isDestroyed()) win.webContents.send('stream-response', { requestId, chunk: chunk.toString(), done: false }); });
    res.on('end', () => { if (!win.isDestroyed()) win.webContents.send('stream-response', { requestId, chunk: '', done: true }); });
  });
  request.on('error', (err) => { if (!win.isDestroyed()) win.webContents.send('stream-response', { requestId, error: err.message, done: true }); });
  if (body) request.write(JSON.stringify(body));
  request.end();
});

ipcMain.handle('set-ignore-mouse', (e, ignore) => win && win.setIgnoreMouseEvents(ignore, { forward: true }));
ipcMain.handle('set-undetectable', (e, state) => win && win.setContentProtection(state));
ipcMain.handle('quit-app', () => app.quit());
ipcMain.handle('get-screen-capture', async () => {
  win.setOpacity(0);
  await new Promise(r => setTimeout(r, 150));
  try {
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1920, height: 1080 } });
    win.setOpacity(1); return sources[0].thumbnail.toDataURL();
  } catch (e) { win.setOpacity(1); throw e; }
});

ipcMain.handle('check-for-updates', () => autoUpdater.checkForUpdates());
ipcMain.handle('quit-and-install', () => autoUpdater.quitAndInstall());

autoUpdater.on('update-available', () => win?.webContents.send('update-msg', { status: 'available' }));
autoUpdater.on('download-progress', (p) => win?.webContents.send('update-msg', { status: 'downloading', percent: p.percent }));
autoUpdater.on('update-downloaded', () => win?.webContents.send('update-msg', { status: 'ready' }));
autoUpdater.on('update-not-available', () => win?.webContents.send('update-msg', { status: 'uptodate' }));

app.whenReady().then(async () => { await checkMacPermissions(); createWindow(); createTray(); if (!isDev) autoUpdater.checkForUpdatesAndNotify(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });