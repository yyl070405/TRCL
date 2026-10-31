import path from 'node:path';
import fsp from 'node:fs/promises';
import { CACHE_HOME, ensureDir, exists, fetchJson, readJson, writeJson } from './util.js';

const OFFICIAL = {
  manifest: 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json',
  versionJson: (id) => `https://piston-meta.mojang.com/v1/packages/${id}/client.json`, // 仅占位，实际用 manifest.url
  resources: 'https://resources.download.minecraft.net',
  libraries: 'https://libraries.minecraft.net',
};

const BMCLAPI = {
  manifest: 'https://bmclapi2.bangbang93.com/mc/game/version_manifest_v2.json',
  versionJson: (id) => `https://bmclapi2.bangbang93.com/version/${id}/json`,
  resources: 'https://bmclapi2.bangbang93.com/assets',
  libraries: 'https://bmclapi2.bangbang93.com/maven',
};

export const SOURCES = { official: OFFICIAL, bmclapi: BMCLAPI };

const MANIFEST_TTL = 5 * 60 * 1000;

export class MinecraftMeta {
  constructor({ root, mirror = 'official' }) {
    this.root = root;
    this.mirror = mirror;
    this.source = SOURCES[mirror] || OFFICIAL;
    this.shared = path.join(root, 'shared');
    this.versionsDir = path.join(this.shared, 'versions');
    this.cacheDir = path.join(CACHE_HOME, 'meta');
    this._manifest = null;
    this._manifestAt = 0;
  }

  async manifest({ force = false } = {}) {
    const fresh = this._manifest && Date.now() - this._manifestAt < MANIFEST_TTL;
    if (fresh && !force) return this._manifest;

    const diskPath = path.join(this.cacheDir, 'version_manifest.json');
    if (!force) {
      try {
        const st = await fsp.stat(diskPath);
        if (Date.now() - st.mtimeMs < MANIFEST_TTL) {
          const cached = await readJson(diskPath);
          if (cached?.versions?.length) {
            this._manifest = cached;
            this._manifestAt = Date.now();
            return cached;
          }
        }
      } catch {
        /* ignore */
      }
    }

    let data;
    try {
      data = await fetchJson(this.source.manifest, { timeout: 30000 });
    } catch (e) {
      const cached = await readJson(diskPath);
      if (cached?.versions?.length) {
        this._manifest = cached;
        this._manifestAt = Date.now();
        return cached;
      }
      throw new Error(`获取版本列表失败：${e.message}`);
    }
    if (!data?.versions?.length) throw new Error('版本列表格式异常');
    await writeJson(diskPath, data);
    this._manifest = data;
    this._manifestAt = Date.now();
    return data;
  }

  async versionDir(id) {
    return path.join(this.versionsDir, id);
  }

  async versionJsonPath(id) {
    return path.join(this.versionsDir, id, `${id}.json`);
  }

  /** 读取（必要时下载）某个版本的原始 JSON。 */
  async versionJson(id) {
    const file = await this.versionJsonPath(id);
    const cached = await readJson(file);
    if (cached) return cached;

    const manifest = await this.manifest();
    const entry = manifest.versions.find((v) => v.id === id);
    let url;
    if (this.mirror === 'bmclapi') url = this.source.versionJson(id);
    else if (entry?.url) url = entry.url;
    else throw new Error(`找不到版本 ${id}`);

    let data;
    try {
      data = await fetchJson(url, { timeout: 30000 });
    } catch (e) {
      if (!entry?.url) throw e;
      data = await fetchJson(entry.url, { timeout: 30000 });
    }
    await ensureDir(path.dirname(file));
    await writeJson(file, data);
    return data;
  }

  /** 跟随 inheritsFrom 链合并，返回可直接用于安装/启动的完整版本 JSON。 */
  async resolve(id, depth = 0) {
    if (depth > 6) throw new Error(`版本继承链过深: ${id}`);
    const json = await this.versionJson(id);
    if (!json.inheritsFrom) return { ...json, id };
    const parent = await this.resolve(json.inheritsFrom, depth + 1);
    return mergeVersions(parent, json);
  }

  async listVersions() {
    const manifest = await this.manifest();
    return manifest.versions.map((v) => ({ id: v.id, type: v.type, releaseTime: v.releaseTime }));
  }

  /** 已安装（本地有 JSON）的版本 id 列表。 */
  async installedVersions() {
    try {
      const dirs = await fsp.readdir(this.versionsDir, { withFileTypes: true });
      const out = [];
      for (const d of dirs) {
        if (!d.isDirectory()) continue;
        if (await exists(path.join(this.versionsDir, d.name, `${d.name}.json`))) out.push(d.name);
      }
      return out;
    } catch {
      return [];
    }
  }
}

export function mergeVersions(parent, child) {
  const out = { ...parent };
  const scalar = [
    'id',
    'mainClass',
    'assets',
    'assetIndex',
    'javaVersion',
    'type',
    'releaseTime',
    'time',
    'logging',
    'minimumLauncherVersion',
    'complianceLevel',
    'jar',
    'downloads',
  ];
  for (const key of scalar) {
    if (child[key] !== undefined) out[key] = child[key];
  }
  out.libraries = [...(parent.libraries || []), ...(child.libraries || [])];

  const pa = parent.arguments || {};
  const ca = child.arguments || {};
  if (parent.arguments || child.arguments) {
    out.arguments = {
      game: [...(pa.game || []), ...(ca.game || [])],
      jvm: [...(pa.jvm || []), ...(ca.jvm || [])],
    };
  }
  if (child.minecraftArguments !== undefined) out.minecraftArguments = child.minecraftArguments;
  delete out.inheritsFrom;
  out.id = child.id || parent.id;
  return out;
}
