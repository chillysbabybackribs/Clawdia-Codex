import { app, BrowserWindow } from 'electron';
import * as path from 'path';
import { initDb } from './db';
import { ElectronBrowserService } from './browser/ElectronBrowserService';
import { registerIpc } from './registerIpc';
import { startBrowserBridge } from './browserBridge';

const isDev = process.env.NODE_ENV === 'development';
const isLinux = process.platform === 'linux';

app.setName('clawdia');

if (isLinux) {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('enable-unsafe-swiftshader');
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    frame: false,
    backgroundColor: '#0f0f0f',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    console.log(`[renderer:console:${level}] ${message} (${sourceId}:${line})`);
  });

  return win;
}

async function createAppWindow(): Promise<void> {
  const win = createWindow();

  const userDataPath = app.getPath('userData');
  const browserService = new ElectronBrowserService(win, userDataPath);
  await browserService.init();
  registerIpc(browserService);
  startBrowserBridge(browserService);

  if (isDev) {
    win.loadURL('http://127.0.0.1:5174');
  } else {
    win.loadFile(path.join(__dirname, '../../dist/renderer/index.html'));
  }
}

app.whenReady().then(async () => {
  if (!initDb()) {
    console.error('[main] Database initialization failed');
  }
  await createAppWindow();

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createAppWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
