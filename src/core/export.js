import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { ensureDir, slugify } from './util.js';
import { createZip } from './zip-write.js';

const MRPACK_DEP = {
  fabric: 'fabric-loader',
  quilt: 'quilt-loader',
  forge: 'forge',
  neoforge: 'neoforge',
};

const MMC_UID = {
  fabric: 'net.fabricmc.fabric-loader',
  quilt: 'org.quiltmc.quilt-loader',
  forge: 'net.minecraftforge',
  neoforge: 'net.neoforged',
};

async function walkFiles(dir, rel = '') {
  const out = [];
  let entries;
  try {
    entries = await fsp.readdir(path.join(dir, rel), { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const r = rel ? path.join(rel, e.name) : e.name;
    if (e.isDirectory()) out.push(...(await walkFiles(dir, r)));
    else out.push(r);
  }
  return out;
}

async function collect(instanceDir, subdir, { saves = false } = {}) {
  const files = new Map();
  const dirs = ['mods', 'config'];
  if (saves) dirs.push('saves');
  for (const sub of dirs) {
    const root = path.join(instanceDir, sub);
    for (const rel of await walkFiles(root)) {
      if (rel.endsWith('.installed-mods.json')) continue;
      files.set(path.join(sub, rel).replace(/\\/g, '/'), await fsp.readFile(path.join(root, rel)));
    }
  }
  const options = path.join(instanceDir, 'options.txt');
  if (fs.existsSync(options)) {
    files.set('options.txt', await fsp.readFile(options));
  }
  return files;
}

export function mrpackIndex(instance) {
  const deps = { minecraft: instance.mcVersion };
  if (instance.loaderType && instance.loaderType !== 'vanilla' && instance.loaderVersion) {
    deps[MRPACK_DEP[instance.loaderType] || instance.loaderType] = instance.loaderVersion;
  }
  return {
    formatVersion: 1,
    game: 'minecraft',
    versionId: '1.0.0',
    name: instance.name,
    summary: `${instance.mcVersion} · ${instance.loaderType}`,
    files: [],
    dependencies: deps,
  };
}

export function mmcPack(instance) {
  const components = [{ uid: 'net.minecraft', version: instance.mcVersion, important: true }];
  if (instance.loaderType && instance.loaderType !== 'vanilla' && instance.loaderVersion) {
    components.push({ uid: MMC_UID[instance.loaderType] || instance.loaderType, version: instance.loaderVersion });
  }
  return { formatVersion: 1, components };
}

/**
 * 导出实例为其他启动器可导入的包。
 * format: mrpack | multimc
 */
export async function exportInstance({ instance, root, format = 'mrpack', includeSaves = false }) {
  if (!['mrpack', 'multimc'].includes(format)) throw new Error(`不支持的格式: ${format}`);
  const files = await collect(instance.dir, '', { saves: includeSaves });

  let zip;
  if (format === 'mrpack') {
    zip = new Map([['modrinth.index.json', JSON.stringify(mrpackIndex(instance), null, 2)]]);
    for (const [rel, data] of files) zip.set(`overrides/${rel}`, data);
  } else {
    zip = new Map([
      ['instance.cfg', `InstanceType=OneSix\nname=${instance.name}\n`],
      ['mmc-pack.json', JSON.stringify(mmcPack(instance), null, 2)],
    ]);
    for (const [rel, data] of files) zip.set(`.minecraft/${rel}`, data);
  }

  const dir = path.join(root, 'exports');
  await ensureDir(dir);
  const name = `${slugify(instance.name)}-${format}.zip`;
  const file = path.join(dir, name);
  await fsp.writeFile(file, createZip(zip));
  const stat = await fsp.stat(file);
  return { file, name, size: stat.size, format, entries: zip.size };
}
