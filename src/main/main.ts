import { app, BrowserWindow } from 'electron';
import * as path from 'path';
import { initDb } from './db';
import { ElectronBrowserService } from './browser/ElectronBrowserService';
import { registerIpc } from './registerIpc';
import { startBrowserBridge, closeBrowserBridge } from './browserBridge';
import { interruptAllRuns } from './runRegistry';
import { getInterruptedRuns, updateRunStatus } from './db';
import { resumeInterruptedRuns } from './resumeRuns';

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
  // Resume any interrupted runs from previous session
  void resumeInterruptedRuns();

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createAppWindow();
    }
  });
});

app.on('before-quit', async () => {
  // Interrupt all in-flight Codex runs — abort processes but mark as resumable
  const interrupted = interruptAllRuns();
  if (interrupted > 0) {
    console.log(`[main] interrupted ${interrupted} active run(s) on quit`);
    // Persist interrupted status to DB
    const rows = getInterruptedRuns();
    for (const row of rows) {
      if (row.status === 'running') {
        updateRunStatus(row.id, 'interrupted');
      }
    }
  }
  // Close the browser bridge HTTP server so it doesn't hold the process alive
  await closeBrowserBridge();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
