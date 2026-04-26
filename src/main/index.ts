import { app, BrowserWindow, net, protocol } from 'electron';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { registerIpc } from './ipc';

const __dirname = dirname(fileURLToPath(import.meta.url));

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'local-asset',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true
    }
  }
]);

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

function mimeTypeFromPath(filePath: string): string {
  const extension = extname(filePath).toLowerCase();
  if (extension === '.mp3') return 'audio/mpeg';
  if (extension === '.wav') return 'audio/wav';
  if (extension === '.m4a') return 'audio/mp4';
  if (extension === '.ogg') return 'audio/ogg';
  if (extension === '.webm') return 'video/webm';
  if (extension === '.mp4') return 'video/mp4';
  if (extension === '.png') return 'image/png';
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg';
  if (extension === '.webp') return 'image/webp';
  if (extension === '.gif') return 'image/gif';
  if (extension === '.svg') return 'image/svg+xml';
  return 'application/octet-stream';
}

app.whenReady().then(() => {
  protocol.handle('local-asset', (request) => {
    const pathParam = request.url.split('?path=')[1] ?? '';
    const assetPath = pathParam ? decodeURIComponent(pathParam) : '';
    if (!assetPath) {
      return new Response('Missing path', { status: 400 });
    }
    const extension = extname(assetPath).toLowerCase();
    const isMedia =
      extension === '.mp3' ||
      extension === '.wav' ||
      extension === '.m4a' ||
      extension === '.ogg' ||
      extension === '.mp4' ||
      extension === '.webm';
    if (!isMedia) {
      return net.fetch(pathToFileURL(assetPath).toString());
    }

    try {
      const fileStat = statSync(assetPath);
      const fileSize = fileStat.size;
      const rangeHeader = request.headers.get('range');
      const mimeType = mimeTypeFromPath(assetPath);

      if (rangeHeader) {
        const matched = /bytes=(\d*)-(\d*)/i.exec(rangeHeader);
        if (!matched) {
          return new Response('Invalid range', { status: 416 });
        }
        const start = matched[1] ? Number.parseInt(matched[1], 10) : 0;
        const requestedEnd = matched[2] ? Number.parseInt(matched[2], 10) : fileSize - 1;
        const end = Number.isFinite(requestedEnd) ? Math.min(requestedEnd, fileSize - 1) : fileSize - 1;
        if (!Number.isFinite(start) || start < 0 || start >= fileSize || end < start) {
          return new Response('Range not satisfiable', {
            status: 416,
            headers: { 'Content-Range': `bytes */${fileSize}` }
          });
        }

        const chunk = readFileSync(assetPath).subarray(start, end + 1);
        return new Response(request.method === 'HEAD' ? null : chunk, {
          status: 206,
          headers: {
            'Content-Type': mimeType,
            'Content-Length': String(chunk.length),
            'Content-Range': `bytes ${start}-${end}/${fileSize}`,
            'Accept-Ranges': 'bytes',
            'Cache-Control': 'no-cache'
          }
        });
      }

      const bytes = readFileSync(assetPath);
      return new Response(request.method === 'HEAD' ? null : bytes, {
        status: 200,
        headers: {
          'Content-Type': mimeType,
          'Content-Length': String(fileSize),
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'no-cache'
        }
      });
    } catch (error) {
      return new Response(error instanceof Error ? error.message : 'Failed to read asset', { status: 404 });
    }
  });

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
