const { app, BrowserWindow, shell, Menu } = require('electron');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');

const PORT = 34000 + Math.floor(Math.random() * 1000);
let server = null;
let win = null;

function waitForServer(url, tries = 100) {
  return new Promise((resolve, reject) => {
    const attempt = (n) => {
      const req = http.get(url, (res) => {
        res.resume();
        resolve();
      });
      req.on('error', () => {
        if (n <= 0) return reject(new Error('本地服务启动超时'));
        setTimeout(() => attempt(n - 1), 200);
      });
      req.setTimeout(1500, () => req.destroy());
    };
    attempt(tries);
  });
}

async function startServer() {
  const serverPath = path.join(__dirname, '..', 'src', 'server', 'index.js');
  server = spawn(process.execPath, [serverPath], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', PORT: String(PORT), HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  server.stdout.on('data', (d) => console.log(`[server] ${d}`));
  server.stderr.on('data', (d) => console.error(`[server] ${d}`));
  server.on('exit', (code) => console.log(`[server] exited ${code}`));
  await waitForServer(`http://127.0.0.1:${PORT}/api/health`);
}

async function createWindow() {
  win = new BrowserWindow({
    width: 1120,
    height: 740,
    minWidth: 780,
    minHeight: 560,
    backgroundColor: '#0f1115',
    title: 'MC Launcher',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  await win.loadURL(`http://127.0.0.1:${PORT}/`);
  win.on('closed', () => (win = null));
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  try {
    await startServer();
    await createWindow();
  } catch (e) {
    console.error(e);
    app.quit();
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (server && !server.killed) {
    try {
      server.kill();
    } catch {
      /* ignore */
    }
  }
});
