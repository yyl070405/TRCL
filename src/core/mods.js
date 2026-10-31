import fsp from 'node:fs/promises';
import path from 'node:path';
import { readZipEntry } from './zip.js';

const MOD_EXT = /\.jar(\.disabled)?$/i;

/** 从 jar 里尽力解析 mod 元数据（Fabric / Quilt / Forge / NeoForge / 旧版）。 */
export async function readModInfo(jarPath) {
  const fallback = { name: path.basename(jarPath).replace(/\.disabled$/i, '').replace(/\.jar$/i, '') };
  try {
    const fabric = await readZipEntry(jarPath, 'fabric.mod.json');
    if (fabric) {
      const j = JSON.parse(fabric.toString('utf8'));
      return { id: j.id, name: j.name || j.id, version: j.version, description: j.description, loader: 'fabric', icon: j.icon };
    }
    const quilt = await readZipEntry(jarPath, 'quilt.mod.json');
    if (quilt) {
      const j = JSON.parse(quilt.toString('utf8'));
      const q = j.quilt_loader || {};
      return { id: q.id, name: q.metadata?.name || q.id, version: q.version, description: q.metadata?.description, loader: 'quilt' };
    }
    for (const tomlName of ['META-INF/neoforge.mods.toml', 'META-INF/mods.toml']) {
      const toml = await readZipEntry(jarPath, tomlName);
      if (toml) {
        const text = toml.toString('utf8');
        const modId = text.match(/modId\s*=\s*"([^"]+)"/)?.[1];
        const displayName = text.match(/displayName\s*=\s*"([^"]+)"/)?.[1];
        const version = text.match(/^\s*version\s*=\s*"([^"]+)"/m)?.[1];
        return {
          id: modId,
          name: displayName || modId || fallback.name,
          version: version && !version.includes('$') ? version : undefined,
          loader: tomlName.includes('neoforge') ? 'neoforge' : 'forge',
        };
      }
    }
    const legacy = await readZipEntry(jarPath, 'mcmod.info');
    if (legacy) {
      const j = JSON.parse(legacy.toString('utf8'));
      const first = Array.isArray(j) ? j[0] : j.modList?.[0];
      if (first) {
        return {
          id: first.modid,
          name: first.name,
          version: first.version,
          description: first.description,
          loader: 'forge',
        };
      }
    }
  } catch {
    /* 解析失败就用文件名 */
  }
  return fallback;
}

export async function listMods(instanceDir) {
  const dir = path.join(instanceDir, 'mods');
  let files = [];
  try {
    files = await fsp.readdir(dir);
  } catch {
    return [];
  }
  const jars = files.filter((f) => MOD_EXT.test(f));
  const out = [];
  for (const file of jars) {
    const full = path.join(dir, file);
    const st = await fsp.stat(full);
    const info = await readModInfo(full);
    out.push({
      file,
      enabled: !file.endsWith('.disabled'),
      size: st.size,
      mtime: st.mtimeMs,
      ...info,
    });
  }
  return out.sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

export function modsDir(instanceDir) {
  return path.join(instanceDir, 'mods');
}

export async function toggleMod(instanceDir, file) {
  const dir = modsDir(instanceDir);
  const safe = path.basename(file);
  const from = path.join(dir, safe);
  const to = safe.endsWith('.disabled') ? path.join(dir, safe.slice(0, -'.disabled'.length)) : path.join(dir, `${safe}.disabled`);
  if (await existsSafe(from)) await fsp.rename(from, to);
  else if (await existsSafe(to)) await fsp.rename(to, from);
  else throw new Error(`找不到模组文件: ${safe}`);
  return path.basename(to);
}

export async function deleteMod(instanceDir, file) {
  const target = path.join(modsDir(instanceDir), path.basename(file));
  await fsp.rm(target, { force: true });
}

async function existsSafe(p) {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}
