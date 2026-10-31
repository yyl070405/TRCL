import http from 'node:http';
import path from 'node:path';
import fsp from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { LauncherApp } from '../app.js';
import { listLoaders } from '../core/loaders.js';
import { searchMods, installMod, installedManifest } from '../core/modrinth.js';
import { listMods, toggleMod, deleteMod } from '../core/mods.js';
import { installMrpack } from '../core/modpack.js';
import { readJson, exists } from '../core/util.js';
import { sendKey, look } from '../core/input.js';
import { captureScreen, screenAvailable } from '../core/screen.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UI_DIR = path.join(__dirname, '..', '..', 'ui');
const PORT = Number(process.env.PORT || 34120);
const HOST = process.env.HOST || '127.0.0.1';

class Jobs {
  constructor() {
    this.map = new Map();
    this.seq = 0;
  }
  create(type) {
    const id = `${type}-${Date.now()}-${++this.seq}`;
    const job = {
      id,
      type,
      status: 'running',
      progress: { phase: 'start', label: '开始…' },
      logs: [],
      result: null,
      error: null,
      startedAt: new Date().toISOString(),
      finishedAt: null,
    };
    this.map.set(id, job);
    setTimeout(
      () => {
        const j = this.map.get(id);
        if (j && j.status !== 'running' && Date.now() - new Date(j.finishedAt || j.startedAt).getTime() > 30 * 60 * 1000) {
          this.map.delete(id);
        }
      },
      30 * 60 * 1000,
    ).unref?.();
    return job;
  }
  run(type, fn) {
    const job = this.create(type);
    const push = (line) => {
      job.logs.push(String(line));
      if (job.logs.length > 600) job.logs.splice(0, job.logs.length - 600);
    };
    const progress = (p) => {
      job.progress = { ...job.progress, ...p };
      if (p.label) push(`[${new Date().toLocaleTimeString()}] ${p.label}`);
    };
    Promise.resolve()
      .then(() => fn({ job, push, progress, setResult: (r) => (job.result = r) }))
      .then((result) => {
        job.status = 'done';
        job.result = result ?? job.result;
        job.finishedAt = new Date().toISOString();
        job.progress = { ...job.progress, phase: 'done', label: '完成' };
      })
      .catch((e) => {
        job.status = 'error';
        job.error = e.message;
        job.finishedAt = new Date().toISOString();
        job.progress = { ...job.progress, phase: 'error', label: e.message };
        push(`错误: ${e.message}`);
      });
    return job;
  }
  view(id) {
    const j = this.map.get(id);
    if (!j) return null;
    return { ...j, logs: j.logs.slice(-200) };
  }
}

const jobs = new Jobs();
const app = await new LauncherApp().init();

function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(body);
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > 2 * 1024 * 1024) throw new Error('请求体过大');
    chunks.push(c);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new Error('请求体不是合法 JSON');
  }
}

const routes = [];
function route(method, pattern, handler) {
  const keys = [];
  const re = new RegExp(
    `^${pattern.replace(/:\w+/g, (m) => {
      keys.push(m.slice(1));
      return '([^/]+)';
    })}$`,
  );
  routes.push({ method, re, keys, handler });
}

route('GET', '/api/health', async () => ({ ok: true, version: '0.1.0' }));
route('GET', '/api/state', async () => app.snapshot());
route('GET', '/api/versions', async () => {
  const m = await app.meta.manifest();
  return {
    latest: m.latest,
    versions: m.versions.map((v) => ({ id: v.id, type: v.type, releaseTime: v.releaseTime })),
    installed: await app.meta.installedVersions(),
  };
});
route('GET', '/api/loaders', async (_req, _body, _params, query) => {
  const mc = query.get('mc');
  if (!mc) throw new Error('缺少 mc 参数');
  return listLoaders(mc);
});
route('GET', '/api/disk', async () => ({
  usage: await app.diskUsage(),
}));

route('GET', '/api/home', async (_req, _body, _params, query) => app.homeFeed({ force: query?.force === '1' }));
route('GET', '/api/settings', async () => app.settings);
route('PATCH', '/api/settings', async (_req, body) => app.saveSettings(body));

route('POST', '/api/accounts/offline', async (_req, body) => app.addOfflineAccount(body.name));
route('POST', '/api/accounts/microsoft/start', async () => {
  const info = await app.sessions.start();
  app.sessions.run(info.id);
  return info;
});
route('GET', '/api/accounts/microsoft/:id', async (_req, _body, params) => app.sessions.get(params.id));
route('POST', '/api/accounts/microsoft/:id/finish', async (_req, _body, params) => app.addMicrosoftAccount(params.id));
route('POST', '/api/accounts/select', async (_req, body) => {
  await app.accounts.select(body.uuid);
  return app.accounts.list();
});
route('DELETE', '/api/accounts/:uuid', async (_req, _body, params) => {
  await app.accounts.remove(params.uuid);
  return app.accounts.list();
});

route('POST', '/api/instances', async (_req, body) => app.instances.create(body));
route('PATCH', '/api/instances/:id', async (_req, body, params) => app.instances.update(params.id, body));
route('DELETE', '/api/instances/:id', async (_req, _body, params) => {
  await app.instances.remove(params.id);
  return { ok: true };
});

route('POST', '/api/instances/:id/install', async (_req, _body, params) => {
  const inst = await app.instances.get(params.id);
  const job = jobs.run('install', async ({ progress }) => {
    const r = await app.prepareInstance(inst, progress, { force: true });
    return { instanceId: inst.id, ...r };
  });
  return { jobId: job.id };
});

route('POST', '/api/instances/:id/launch', async (_req, body, params) => {
  const job = jobs.run('launch', async ({ progress, push }) => {
    const r = await app.launchInstance(params.id, { onProgress: progress, onLine: push, locale: body.locale });
    push(`[launcher] pid=${r.pid}`);
    const exit = await r.exited;
    push(`[launcher] 游戏已退出 code=${exit.code}`);
    return { pid: r.pid, logFile: r.logFile, exitCode: exit.code };
  });
  return { jobId: job.id };
});

route('POST', '/api/instances/:id/export', async (_req, body, params) => {
  return app.exportInstance(params.id, {
    format: body.format || 'mrpack',
    includeSaves: body.includeSaves === true,
  });
});

route('GET', '/api/instances/:id/options', async (_req, _body, params) => {
  const data = await app.gameOptions(params.id);
  return data;
});

route('PUT', '/api/instances/:id/options', async (_req, body, params) => {
  const options = await app.saveGameOptions(params.id, body.patch || {});
  return { options };
});

route('POST', '/api/instances/:id/input', async (_req, body) => {
  await sendKey(body.key, body.action || 'tap');
  return { ok: true };
});

route('POST', '/api/instances/:id/look', async (_req, body) => {
  await look(body.dx, body.dy);
  return { ok: true };
});

route('POST', '/api/instances/:id/stop', async (_req, _body, params) => ({
  stopped: await app.stopInstance(params.id),
}));

route('GET', '/api/instances/:id/mods', async (_req, _body, params) => {
  const inst = await app.instances.get(params.id);
  const [mods, manifest] = await Promise.all([listMods(inst.dir), installedManifest(inst.dir)]);
  return { mods, manifest: manifest.files || {} };
});

route('POST', '/api/instances/:id/mods/toggle', async (_req, body, params) => {
  const inst = await app.instances.get(params.id);
  return { file: await toggleMod(inst.dir, body.file) };
});

route('DELETE', '/api/instances/:id/mods/:file', async (_req, _body, params) => {
  const inst = await app.instances.get(params.id);
  await deleteMod(inst.dir, params.file);
  return { ok: true };
});

route('GET', '/api/mods/search', async (_req, _body, _params, query) => {
  return searchMods({
    query: query.get('q') || '',
    gameVersion: query.get('mc') || undefined,
    loader: query.get('loader') || undefined,
    limit: Number(query.get('limit') || 20),
    offset: Number(query.get('offset') || 0),
  });
});

route('POST', '/api/instances/:id/mods/install', async (_req, body, params) => {
  const inst = await app.instances.get(params.id);
  const job = jobs.run('mods', async ({ progress }) => {
    const installed = await installMod({ projectId: body.projectId, instance: inst, onProgress: progress });
    return { installed };
  });
  return { jobId: job.id };
});

route('POST', '/api/modpacks', async (_req, body) => {
  const job = jobs.run('modpack', async ({ progress }) => {
    const inst = await installMrpack({
      source: body.url,
      root: app.root,
      meta: app.meta,
      installer: app.installer,
      instances: app.instances,
      javaPath: (await app.listJava())[0]?.path,
      onProgress: progress,
    });
    return { instanceId: inst.id };
  });
  return { jobId: job.id };
});

route('POST', '/api/java/install', async (_req, body) => {
  const job = jobs.run('jre', async ({ progress }) => {
    const info = await app.installJreFor(Number(body.major || 21), progress);
    return { java: info };
  });
  return { jobId: job.id };
});

route('GET', '/api/jobs/:id', async (_req, _body, params) => {
  const j = jobs.view(params.id);
  if (!j) throw new Error('任务不存在或已过期');
  return j;
});

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

async function serveStatic(req, res, pathname) {
  let rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const file = path.resolve(UI_DIR, rel);
  if (!file.startsWith(path.resolve(UI_DIR) + path.sep) && file !== path.resolve(UI_DIR, 'index.html')) {
    return json(res, 403, { error: '禁止访问' });
  }
  try {
    const data = await fsp.readFile(file);
    res.writeHead(200, {
      'content-type': MIME[path.extname(file)] || 'application/octet-stream',
      'cache-control': 'no-cache',
    });
    res.end(data);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('404');
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(url.pathname);

  if (!pathname.startsWith('/api/')) {
    if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req, res, pathname);
    return json(res, 405, { error: '不支持的方法' });
  }

  if (pathname === '/api/screen' && req.method === 'GET') {
    if (!screenAvailable()) return json(res, 503, { error: '当前环境没有可截取的显示器' });
    try {
      const png = await captureScreen();
      res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store' });
      res.end(png);
    } catch (e) {
      return json(res, 500, { error: e.message });
    }
    return;
  }

  for (const r of routes) {
    if (r.method !== req.method) continue;
    const m = r.re.exec(pathname);
    if (!m) continue;
    const params = Object.fromEntries(r.keys.map((k, i) => [k, m[i + 1]]));
    try {
      const body = req.method === 'GET' || req.method === 'DELETE' ? {} : await readBody(req);
      const data = await r.handler(req, body, params, url.searchParams);
      return json(res, 200, data ?? { ok: true });
    } catch (e) {
      const status = /不存在|没有|缺少|不匹配|还没有/.test(e.message) ? 400 : 500;
      return json(res, status, { error: e.message });
    }
  }
  return json(res, 404, { error: '接口不存在' });
});

server.listen(PORT, HOST, () => {
  const shown = HOST === '0.0.0.0' ? '127.0.0.1' : HOST;
  console.log(`MC Launcher 已启动: http://${shown}:${PORT}`);
  console.log(`数据目录: ${app.root}`);
  if (process.argv.includes('--open')) {
    const cmd =
      process.platform === 'win32' ? ['cmd', ['/c', 'start', '', `http://${shown}:${PORT}`]]
      : process.platform === 'darwin' ? ['open', [`http://${shown}:${PORT}`]]
      : ['xdg-open', [`http://${shown}:${PORT}`]];
    import('node:child_process').then(({ spawn }) => {
      try {
        spawn(cmd[0], cmd[1], { detached: true, stdio: 'ignore' }).unref();
      } catch {
        /* ignore */
      }
    });
  }
});
