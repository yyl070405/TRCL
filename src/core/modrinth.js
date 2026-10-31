import path from 'node:path';
import fsp from 'node:fs/promises';
import { downloadFile, ensureDir, fetchJson, readJson, writeJson } from './util.js';

const API = 'https://api.modrinth.com/v2';
const MANIFEST = '.installed-mods.json';

export async function searchMods({ query = '', gameVersion, loader, limit = 20, offset = 0 } = {}) {
  const facets = [['project_type:mod']];
  if (gameVersion) facets.push([`versions:${gameVersion}`]);
  if (loader && loader !== 'vanilla') facets.push([`categories:${loader}`]);
  const url =
    `${API}/search?query=${encodeURIComponent(query)}` +
    `&facets=${encodeURIComponent(JSON.stringify(facets))}` +
    `&limit=${limit}&offset=${offset}&index=relevance`;
  const data = await fetchJson(url, { timeout: 20000 });
  return {
    total: data.total_hits,
    hits: (data.hits || []).map((h) => ({
      id: h.project_id,
      slug: h.slug,
      title: h.title,
      description: h.description,
      downloads: h.downloads,
      icon: h.icon_url,
      author: h.author,
      categories: h.categories,
    })),
  };
}

export async function getProjectVersions(projectId, { gameVersion, loader } = {}) {
  const params = new URLSearchParams();
  if (gameVersion) params.set('game_versions', JSON.stringify([gameVersion]));
  if (loader && loader !== 'vanilla') params.set('loaders', JSON.stringify([loader]));
  return fetchJson(`${API}/project/${encodeURIComponent(projectId)}/version?${params}`, { timeout: 20000 });
}

function pickFile(version) {
  return version.files?.find((f) => f.primary) || version.files?.[0];
}

function compatible(version, { gameVersion, loader }) {
  if (gameVersion && !version.game_versions?.includes(gameVersion)) return false;
  if (loader && loader !== 'vanilla' && !version.loaders?.includes(loader)) return false;
  return true;
}

async function readManifest(mods) {
  return (await readJson(path.join(mods, MANIFEST), { files: {} })) || { files: {} };
}

async function writeManifest(mods, data) {
  await writeJson(path.join(mods, MANIFEST), data);
}

/**
 * 安装一个 Modrinth 项目到实例，自动补齐 required 依赖。
 */
export async function installMod({ projectId, instance, onProgress = () => {}, depth = 0, seen = new Set() }) {
  if (seen.has(projectId) || depth > 3) return [];
  seen.add(projectId);

  const mods = path.join(instance.dir, 'mods');
  await ensureDir(mods);
  const manifest = await readManifest(mods);

  let versions = await getProjectVersions(projectId, {
    gameVersion: instance.mcVersion,
    loader: instance.loaderType === 'vanilla' ? null : instance.loaderType,
  });
  versions = (versions || []).filter((v) => compatible(v, { gameVersion: instance.mcVersion, loader: instance.loaderType }));
  if (!versions.length) {
    throw new Error(`没有找到适配 ${instance.mcVersion} ${instance.loaderType} 的版本`);
  }
  const version = versions[0];
  const file = pickFile(version);
  if (!file) throw new Error('该版本没有可下载文件');

  // 同名文件已存在则跳过
  if (manifest.files[file.filename]) {
    onProgress({ phase: 'mods', label: `已安装 ${file.filename}` });
    return [];
  }

  onProgress({ phase: 'mods', label: `下载 ${file.filename}` });
  const dest = path.join(mods, path.basename(file.filename));
  await downloadFile(file.url, dest, { sha1: file.hashes?.sha1, size: file.size });
  manifest.files[file.filename] = { projectId, versionId: version.id, name: version.name };
  await writeManifest(mods, manifest);

  const installed = [{ file: file.filename, projectName: version.name, projectId }];

  for (const dep of version.dependencies || []) {
    if (dep.dependency_type !== 'required' || !dep.project_id || dep.project_id === projectId) continue;
    try {
      const added = await installMod({
        projectId: dep.project_id,
        instance,
        onProgress,
        depth: depth + 1,
        seen,
      });
      installed.push(...added);
    } catch (e) {
      onProgress({ phase: 'mods', label: `依赖安装失败: ${e.message}` });
    }
  }
  return installed;
}

/** 用本地缓存记录判断某模组是否由启动器安装（可显示来源）。 */
export async function installedManifest(instanceDir) {
  return (await readJson(path.join(instanceDir, 'mods', MANIFEST), { files: {} })) || { files: {} };
}

export async function removeFromManifest(instanceDir, filename) {
  const mods = path.join(instanceDir, 'mods');
  const data = await readManifest(mods);
  delete data.files[filename];
  await writeManifest(mods, data);
}
