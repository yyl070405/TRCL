import fsp from 'node:fs/promises';
import path from 'node:path';
import { ensureDir, exists, readJson, slugify, uuidV4, writeJson } from './util.js';

const DEFAULTS = {
  memoryMb: 2048,
  minMemoryMb: 512,
  width: 854,
  height: 480,
  jvmArgs: [],
  loaderType: 'vanilla',
};

export class InstanceManager {
  constructor({ root }) {
    this.root = root;
    this.instancesDir = path.join(root, 'instances');
  }

  async list() {
    await ensureDir(this.instancesDir);
    const entries = await fsp.readdir(this.instancesDir, { withFileTypes: true });
    const out = [];
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const cfg = await readJson(path.join(this.instancesDir, e.name, 'instance.json'), null);
      if (cfg) out.push(this.normalize(cfg));
    }
    return out.sort((a, b) => String(b.lastPlayed || '').localeCompare(String(a.lastPlayed || '')));
  }

  normalize(cfg) {
    return { ...DEFAULTS, ...cfg, dir: path.join(this.instancesDir, cfg.id) };
  }

  assertId(id) {
    if (!/^[A-Za-z0-9._-]+$/.test(String(id || ''))) throw new Error(`非法实例 id: ${id}`);
  }

  async get(id) {
    this.assertId(id);
    const cfg = await readJson(path.join(this.instancesDir, id, 'instance.json'), null);
    if (!cfg) throw new Error(`实例不存在: ${id}`);
    return this.normalize(cfg);
  }

  async create({ name, mcVersion, loaderType = 'vanilla', loaderVersion = null, versionId = null }) {
    if (!name || !mcVersion) throw new Error('需要实例名和游戏版本');
    const base = slugify(name, 'instance');
    let id = `${base}-${uuidV4().slice(0, 4)}`;
    while (await exists(path.join(this.instancesDir, id))) id = `${base}-${uuidV4().slice(0, 4)}`;
    const cfg = {
      ...DEFAULTS,
      ...(loaderType && loaderType !== 'vanilla' ? { loaderType } : {}),
      id,
      name: String(name).trim(),
      mcVersion,
      loaderType,
      loaderVersion,
      versionId: versionId || mcVersion,
      createdAt: new Date().toISOString(),
      lastPlayed: null,
    };
    await ensureDir(path.join(this.instancesDir, id));
    for (const sub of ['mods', 'saves', 'resourcepacks', 'shaderpacks', 'logs', 'natives', 'config']) {
      await ensureDir(path.join(this.instancesDir, id, sub));
    }
    await this.write(cfg);
    return this.normalize(cfg);
  }

  async write(cfg) {
    const { dir, ...rest } = cfg;
    await writeJson(path.join(this.instancesDir, cfg.id, 'instance.json'), rest);
  }

  async update(id, patch) {
    const inst = await this.get(id);
    const merged = { ...inst, ...patch, id: inst.id, dir: inst.dir };
    await this.write(merged);
    return merged;
  }

  async remove(id) {
    this.assertId(id);
    await fsp.rm(path.join(this.instancesDir, id), { recursive: true, force: true });
  }

  async touch(id) {
    await this.update(id, { lastPlayed: new Date().toISOString() });
  }
}
