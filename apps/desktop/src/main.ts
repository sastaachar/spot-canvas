import { app, BrowserWindow, ipcMain, session, shell } from 'electron';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const DEV_URL = process.env['SPOT_CANVAS_DEV_URL'];
const WEB_DIST = path.resolve(__dirname, '../../web/dist/index.html');
const LAYOUT_FILE = 'layout.json';
const WINDOW = { width: 1200, height: 800, minWidth: 640, minHeight: 420 };

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  'font-src https://fonts.gstatic.com',
  "img-src 'self' data:",
  'frame-src https: http:',
  "connect-src 'self'"
].join('; ');

const layoutPath = () => path.join(app.getPath('userData'), LAYOUT_FILE);

async function readLayout(): Promise<string | null> {
  try {
    return await readFile(layoutPath(), 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

async function writeLayout(json: unknown): Promise<void> {
  if (typeof json !== 'string') throw new TypeError('layout must be a JSON string');
  await mkdir(app.getPath('userData'), { recursive: true });
  await writeFile(layoutPath(), json, 'utf8');
}

function createWindow(): void {
  const win = new BrowserWindow({
    ...WINDOW,
    title: 'Spot Canvas',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    backgroundColor: '#F5F2ED',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:') || url.startsWith('http:')) void shell.openExternal(url);
    return { action: 'deny' };
  });

  if (DEV_URL) void win.loadURL(DEV_URL);
  else void win.loadFile(WEB_DIST);
}

app.whenReady().then(() => {
  if (!DEV_URL) {
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [CSP] } });
    });
  }

  ipcMain.handle('layout:read', readLayout);
  ipcMain.handle('layout:write', (_event, json: unknown) => writeLayout(json));

  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
