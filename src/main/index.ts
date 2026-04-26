import { app, BrowserWindow } from 'electron';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerIpc } from './ipc';

const __dirname = dirname(fileURLToPath(import.meta.url));

function resolveAppIconPath(): string | undefined {
  const iconCandidates = [
    join(__dirname, '../../src/assets/icons/app.png'),
    join(process.cwd(), 'src/assets/icons/app.png')
  ];
  return iconCandidates.find((candidate) => existsSync(candidate));
}

function createWindow() {
  const iconPath = resolveAppIconPath();

  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 720,
    title: 'AI Creator',
    ...(iconPath ? { icon: iconPath } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  const devServerUrl = process.env['VITE_DEV_SERVER_URL'] ?? process.env['ELECTRON_RENDERER_URL'];
  if (devServerUrl) {
    win.loadURL(devServerUrl);
  } else {
    const bundledRendererHtml = join(__dirname, '../renderer/index.html');
    const rootRendererHtml = join(__dirname, '../../index.html');
    const rendererHtml = existsSync(bundledRendererHtml) ? bundledRendererHtml : rootRendererHtml;
    win.loadFile(rendererHtml);
  }
}

app.whenReady().then(() => {
  const iconPath = resolveAppIconPath();
  if (iconPath && process.platform === 'darwin') {
    app.dock?.setIcon(iconPath);
  }

  registerIpc();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
