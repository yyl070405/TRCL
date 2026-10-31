import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export const isWindows = process.platform === 'win32';
export const isMac = process.platform === 'darwin';
export const USER_AGENT = 'TRCL/0.1 (+https://github.com/yyl070405/TRCL)';
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function defaultHome() {
  if (isWindows) {
    const appdata = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(appdata, 'MCLauncher');
  }
  if (isMac) return path.join(os.homedir(), 'Library', 'Application Support', 'MCLauncher');
  return path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'mc-launcher');
}

/** Root data dir. Override with MC_LAUNCHER_HOME. */
export const HOME = process.env.MC_LAUNCHER_HOME || defaultHome();

export async function ensureDir(dir) {
  await fsp.mkdir(dir, { recursive: true });
}

export async function exists(p) {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

export async function statSafe(p) {
  try {
    return await fsp.stat(p);
  } catch {
    return null;
  }
}

export async function readJson(file, fallback = null) {
  try {
    return JSON.parse(await fsp.readFile(file, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return fallback;
    throw new Error(`无法读取 JSON ${file}: ${e.message}`);
  }
}

/** Atomic JSON write (tmp + rename) so a crash cannot corrupt configs. */
export async function writeJson(file, data) {
  await ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
  await fsp.rename(tmp, file);
}

export async function removeSafe(target) {
  await fsp.rm(target, { recursive: true, force: true });
}

export function sha1Buffer(buf) {
  return crypto.createHash('sha1').update(buf).digest('hex');
}

export async function sha1File(file) {
  const hash = crypto.createHash('sha1');
  await pipeline(fs.createReadStream(file), hash);
  return hash.digest('hex');
}

export function uuidV4() {
  return crypto.randomUUID();
}

/** Deterministic offline UUID, identical to vanillas "OfflinePlayer:<name>" scheme. */
export function offlineUuid(name) {
  const h = crypto.createHash('md5').update(`OfflinePlayer:${name}`, 'utf8').digest();
  h[6] = (h[6] & 0x0f) | 0x30;
  h[8] = (h[8] & 0x3f) | 0x80;
  const hex = h.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function formatBytes(n) {
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function slugify(s, fallback = 'instance') {
  const out = String(s || '')
    .trim()
    .replace(/[\\/:*?"<>|\s]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
  return out || fallback;
}

/** 并发执行，保持结果顺序。worker 抛错会整体失败。 */
export async function pool(items, concurrency, worker, onTick) {
  const results = new Array(items.length);
  let next = 0;
  let done = 0;
  const runners = Array.from({ length: Math.max(1, Math.min(concurrency, items.length || 1)) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
      done += 1;
      onTick?.(done, items.length);
    }
  });
  await Promise.all(runners);
  return results;
}

export async function fetchJson(url, { retries = 2, timeout = 25000, headers = {} } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(timeout),
        headers: { 'user-agent': USER_AGENT, accept: 'application/json', ...headers },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      return await res.json();
    } catch (e) {
      lastErr = e;
      if (attempt < retries) await sleep(400 * 2 ** attempt);
    }
  }
  throw new Error(`请求失败 ${url}: ${lastErr?.message || lastErr}`);
}

export async function fetchText(url, { timeout = 25000, headers = {} } = {}) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(timeout),
    headers: { 'user-agent': USER_AGENT, ...headers },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} (${url})`);
  return res.text();
}

export async function fetchBuffer(url, { timeout = 30000, headers = {} } = {}) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(timeout),
    headers: { 'user-agent': USER_AGENT, ...headers },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} (${url})`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * 下载到文件，带重试、校验和原子写入。
 * 已存在且大小/SHA1 匹配时直接跳过。
 */
export async function downloadFile(url, dest, { sha1, size, retries = 3, timeout = 180000, onBytes } = {}) {
  const st = await statSafe(dest);
  if (st && st.isFile()) {
    if (typeof size === 'number' && st.size === size) return { skipped: true, path: dest };
    if (!size && sha1) {
      const got = await sha1File(dest);
      if (got === sha1) return { skipped: true, path: dest };
    }
    if (sha1) {
      const got = await sha1File(dest);
      if (got === sha1) return { skipped: true, path: dest };
    }
  }

  await ensureDir(path.dirname(dest));
  const part = `${dest}.part`;
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(timeout),
        headers: { 'user-agent': USER_AGENT },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      const total = Number(res.headers.get('content-length') || 0);
      let seen = 0;
      const body = Readable.fromWeb(res.body);
      body.on('data', (chunk) => {
        seen += chunk.length;
        onBytes?.(chunk.length, total);
      });
      await pipeline(body, fs.createWriteStream(part));
      if (sha1) {
        const got = await sha1File(part);
        if (got !== sha1) throw new Error(`校验失败 ${path.basename(dest)}: 期望 ${sha1} 实际 ${got}`);
      }
      await fsp.rename(part, dest);
      return { skipped: false, path: dest, bytes: seen };
    } catch (e) {
      lastErr = e;
      await removeSafe(part);
      if (attempt < retries) await sleep(500 * 2 ** attempt);
    }
  }
  throw new Error(`下载失败 ${url}: ${lastErr?.message || lastErr}`);
}

/** group:artifact:version[:classifier][@ext] -> maven 路径 */
export function mavenPath(name) {
  let ext = 'jar';
  let n = name;
  if (n.includes('@')) {
    const at = n.lastIndexOf('@');
    ext = n.slice(at + 1);
    n = n.slice(0, at);
  }
  const parts = n.split(':');
  if (parts.length < 3) throw new Error(`无法解析 Maven 坐标: ${name}`);
  const [group, artifact, version, classifier] = parts;
  const file = classifier ? `${artifact}-${version}-${classifier}.${ext}` : `${artifact}-${version}.${ext}`;
  return `${group.replace(/\./g, '/')}/${artifact}/${version}/${file}`;
}

export function majorOfJavaVersion(v) {
  if (!v) return null;
  if (v.startsWith('1.')) return Number(v.split('.')[1]);
  return Number(v.split('.')[0]);
}
