import path from 'node:path';
import { spawn } from 'node:child_process';
import { downloadFile, ensureDir, exists, fetchJson, fetchText, readJson, writeJson } from './util.js';

const FABRIC_META = 'https://meta.fabricmc.net';
const QUILT_META = 'https://meta.quiltmc.org';
const FORGE_MAVEN = 'https://maven.minecraftforge.net';
const NEOFORGE_MAVEN = 'https://maven.neoforged.net/releases';
const FORGE_PROMOS = 'https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json';

export const LOADER_LABELS = {
  vanilla: '原版',
  fabric: 'Fabric',
  quilt: 'Quilt',
  forge: 'Forge',
  neoforge: 'NeoForge',
};

/** Forge/NeoForge 安装器要求目标目录里有 launcher_profiles.json。 */
async function ensureLauncherProfiles(dir) {
  await ensureDir(dir);
  const file = path.join(dir, 'launcher_profiles.json');
  if (await exists(file)) return;
  await writeJson(file, {
    profiles: {},
    settings: { enableSnapshots: false, enableAdvanced: false, keepLauncherOpen: false },
    version: 3,
  });
}

function runInstaller(javaPath, args, { cwd, onLine, timeoutMs = 15 * 60 * 1000 }) {
  return new Promise((resolve, reject) => {
    const child = spawn(javaPath, args, { cwd, windowsHide: true });
    let output = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('安装器超时（15 分钟）'));
    }, timeoutMs);
    const pump = (src) => {
      let buf = '';
      src.on('data', (d) => {
        buf += d.toString();
        const lines = buf.split(/\r?\n/);
        buf = lines.pop() || '';
        for (const line of lines) {
          output += `${line}\n`;
          onLine?.(line);
        }
      });
      src.on('end', () => {
        if (buf) {
          output += buf;
          onLine?.(buf);
        }
      });
    };
    pump(child.stdout);
    pump(child.stderr);
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(new Error(`无法运行安装器: ${e.message}`));
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(output);
      else reject(new Error(`安装器退出码 ${code}\n${output.slice(-1500)}`));
    });
  });
}

export async function listLoaders(mcVersion) {
  const result = { fabric: [], quilt: [], forge: [], neoforge: [] };
  await Promise.all([
    (async () => {
      try {
        const data = await fetchJson(`${FABRIC_META}/v2/versions/loader/${encodeURIComponent(mcVersion)}`);
        result.fabric = data.map((d) => ({ version: d.loader.version, stable: Boolean(d.loader.stable) }));
      } catch (e) {
        result.fabricError = e.message;
      }
    })(),
    (async () => {
      try {
        const data = await fetchJson(`${QUILT_META}/v3/versions/loader/${encodeURIComponent(mcVersion)}`);
        result.quilt = data.map((d) => ({ version: d.loader.version, stable: Boolean(d.loader.stable) }));
      } catch (e) {
        result.quiltError = e.message;
      }
    })(),
    (async () => {
      try {
        const data = await fetchJson(FORGE_PROMOS);
        const promos = data.promos || {};
        const latest = promos[`${mcVersion}-latest`];
        const recommended = promos[`${mcVersion}-recommended`];
        const set = new Map();
        if (recommended) set.set(recommended, { version: recommended, stable: true });
        if (latest) set.set(latest, { version: latest, stable: latest === recommended });
        result.forge = [...set.values()];
      } catch (e) {
        result.forgeError = e.message;
      }
    })(),
    (async () => {
      try {
        const xml = await fetchText(
          `${NEOFORGE_MAVEN}/net/neoforged/neoforge/maven-metadata.xml`,
          { timeout: 20000 },
        );
        const versions = [...xml.matchAll(/<version>([^<]+)<\/version>/g)].map((m) => m[1]);
        result.neoforge = versions.filter((v) => v.startsWith(neoPrefix(mcVersion))).reverse();
      } catch (e) {
        result.neoforgeError = e.message;
      }
    })(),
  ]);
  return result;
}

/** 1.21.1 -> 21.1, 1.20.4 -> 20.4 */
function neoPrefix(mcVersion) {
  const m = String(mcVersion).match(/^1\.(\d+)(?:\.(\d+))?/);
  if (!m) return 'none';
  return m[2] ? `${m[1]}.${m[2]}` : `${m[1]}.0`;
}

async function saveVersionJson(meta, id, json) {
  const dir = path.join(meta.versionsDir, id);
  await ensureDir(dir);
  const { writeJson } = await import('./util.js');
  await writeJson(path.join(dir, `${id}.json`), json);
}

export async function installFabric({ meta, mcVersion, loaderVersion, onProgress = () => {} }) {
  onProgress({ phase: 'loader', label: '获取 Fabric 配置…' });
  let version = loaderVersion;
  if (!version) {
    const list = await listLoaders(mcVersion);
    const pick = list.fabric.find((v) => v.stable) || list.fabric[0];
    if (!pick) throw new Error('该版本没有可用的 Fabric');
    version = pick.version;
  }
  const url = `${FABRIC_META}/v2/versions/loader/${encodeURIComponent(mcVersion)}/${encodeURIComponent(version)}/profile/json`;
  const json = await fetchJson(url);
  json.inheritsFrom = mcVersion;
  await saveVersionJson(meta, json.id, json);
  return { versionId: json.id, loaderVersion: version };
}

export async function installQuilt({ meta, mcVersion, loaderVersion, onProgress = () => {} }) {
  onProgress({ phase: 'loader', label: '获取 Quilt 配置…' });
  let version = loaderVersion;
  if (!version) {
    const list = await listLoaders(mcVersion);
    const pick = list.quilt.find((v) => v.stable) || list.quilt[0];
    if (!pick) throw new Error('该版本没有可用的 Quilt');
    version = pick.version;
  }
  const url = `${QUILT_META}/v3/versions/loader/${encodeURIComponent(mcVersion)}/${encodeURIComponent(version)}/profile/json`;
  const json = await fetchJson(url);
  json.inheritsFrom = mcVersion;
  await saveVersionJson(meta, json.id, json);
  return { versionId: json.id, loaderVersion: version };
}

export async function installForge({ meta, root, mcVersion, loaderVersion, javaPath, onProgress = () => {} }) {
  let version = loaderVersion;
  if (!version) {
    const promos = (await fetchJson(FORGE_PROMOS)).promos || {};
    version = promos[`${mcVersion}-recommended`] || promos[`${mcVersion}-latest`];
    if (!version) throw new Error(`${mcVersion} 没有官方 Forge 版本`);
  }
  const cacheDir = path.join(root, 'cache', 'installers');
  await ensureDir(cacheDir);
  const file = path.join(cacheDir, `forge-${mcVersion}-${version}-installer.jar`);
  const url = `${FORGE_MAVEN}/net/minecraftforge/forge/${mcVersion}-${version}/forge-${mcVersion}-${version}-installer.jar`;
  if (!(await exists(file))) {
    onProgress({ phase: 'loader', label: `下载 Forge ${version} 安装器…` });
    await downloadFile(url, file, { timeout: 300000 });
  }
  onProgress({ phase: 'loader', label: '运行 Forge 安装器…' });
  await ensureLauncherProfiles(meta.shared);
  await runInstaller(javaPath, ['-jar', file, '--installClient', meta.shared], {
    cwd: meta.shared,
    onLine: (line) => onProgress({ phase: 'loader', label: line.slice(0, 120) }),
  });
  const expected = `${mcVersion}-forge-${version}`;
  if (await exists(path.join(meta.versionsDir, expected, `${expected}.json`))) {
    return { versionId: expected, loaderVersion: version };
  }
  const dirs = await import('node:fs/promises').then((m) => m.readdir(meta.versionsDir, { withFileTypes: true }));
  const found = dirs.find((d) => d.isDirectory() && d.name.includes('forge') && d.name.startsWith(mcVersion));
  if (!found) throw new Error('Forge 安装完成但找不到生成的版本 JSON');
  return { versionId: found.name, loaderVersion: version };
}

export async function installNeoForge({ meta, root, mcVersion, loaderVersion, javaPath, onProgress = () => {} }) {
  let version = loaderVersion;
  if (!version) {
    const xml = await fetchText(`${NEOFORGE_MAVEN}/net/neoforged/neoforge/maven-metadata.xml`);
    const versions = [...xml.matchAll(/<version>([^<]+)<\/version>/g)].map((m) => m[1]);
    const prefix = neoPrefix(mcVersion);
    version = versions.filter((v) => v.startsWith(prefix)).sort().at(-1);
    if (!version) throw new Error(`${mcVersion} 没有可用的 NeoForge`);
  }
  const cacheDir = path.join(root, 'cache', 'installers');
  await ensureDir(cacheDir);
  const file = path.join(cacheDir, `neoforge-${version}-installer.jar`);
  const url = `${NEOFORGE_MAVEN}/net/neoforged/neoforge/${version}/neoforge-${version}-installer.jar`;
  if (!(await exists(file))) {
    onProgress({ phase: 'loader', label: `下载 NeoForge ${version} 安装器…` });
    await downloadFile(url, file, { timeout: 300000 });
  }
  onProgress({ phase: 'loader', label: '运行 NeoForge 安装器…' });
  await ensureLauncherProfiles(meta.shared);
  await runInstaller(javaPath, ['-jar', file, '--installClient', meta.shared], {
    cwd: meta.shared,
    onLine: (line) => onProgress({ phase: 'loader', label: line.slice(0, 120) }),
  });
  const expected = `neoforge-${version}`;
  if (await exists(path.join(meta.versionsDir, expected, `${expected}.json`))) {
    return { versionId: expected, loaderVersion: version };
  }
  throw new Error('NeoForge 安装完成但找不到生成的版本 JSON');
}

export async function installLoader(opts) {
  switch (opts.type) {
    case 'fabric':
      return installFabric(opts);
    case 'quilt':
      return installQuilt(opts);
    case 'forge':
      return installForge(opts);
    case 'neoforge':
      return installNeoForge(opts);
    case 'vanilla':
      return { versionId: opts.mcVersion, loaderVersion: null };
    default:
      throw new Error(`未知加载器: ${opts.type}`);
  }
}
