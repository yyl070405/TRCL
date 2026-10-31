import path from 'node:path';
import fsp from 'node:fs/promises';
import { downloadFile, ensureDir, exists, readJson } from './util.js';
import { readZipEntry, extractZip } from './zip.js';
import { installLoader } from './loaders.js';

function safeDest(base, rel) {
  const target = path.resolve(base, rel);
  const root = path.resolve(base) + path.sep;
  if (!target.startsWith(root)) throw new Error(`整合包内路径越界: ${rel}`);
  return target;
}

function detectLoader(deps = {}) {
  if (deps['fabric-loader']) return { type: 'fabric', version: deps['fabric-loader'] };
  if (deps['quilt-loader']) return { type: 'quilt', version: deps['quilt-loader'] };
  if (deps.forge) return { type: 'forge', version: deps.forge };
  if (deps.neoforge) return { type: 'neoforge', version: deps.neoforge };
  return { type: 'vanilla', version: null };
}

/**
 * 安装 Modrinth .mrpack 整合包，返回新实例。
 */
export async function installMrpack({ source, root, meta, installer, instances, javaPath, onProgress = () => {} }) {
  let file = source;
  if (/^https?:\/\//i.test(source)) {
    const cacheDir = path.join(root, 'cache', 'modpacks');
    await ensureDir(cacheDir);
    const name = decodeURIComponent(source.split('/').pop().split('?')[0]) || 'pack.mrpack';
    file = path.join(cacheDir, name);
    if (!(await exists(file))) {
      onProgress({ phase: 'modpack', label: '下载整合包…' });
      await downloadFile(source, file, { timeout: 600000 });
    }
  }
  if (!(await exists(file))) throw new Error(`找不到整合包文件: ${file}`);

  const indexRaw = await readZipEntry(file, 'modrinth.index.json');
  if (!indexRaw) {
    const cf = await readZipEntry(file, 'manifest.json');
    if (cf) throw new Error('这是 CurseForge 整合包。当前版本只支持 Modrinth (.mrpack) 格式。');
    throw new Error('不是有效的 Modrinth 整合包（缺少 modrinth.index.json）');
  }
  const index = JSON.parse(indexRaw.toString('utf8'));
  const mcVersion = index.dependencies?.minecraft;
  if (!mcVersion) throw new Error('整合包没有声明 Minecraft 版本');
  const loader = detectLoader(index.dependencies);

  onProgress({ phase: 'modpack', label: `创建实例：${index.name || '整合包'}` });
  let instance = await instances.create({
    name: index.name || path.basename(file, '.mrpack'),
    mcVersion,
    loaderType: loader.type,
    loaderVersion: loader.version,
    versionId: mcVersion,
  });

  let versionId = mcVersion;
  let loaderVersion = loader.version;
  if (loader.type !== 'vanilla') {
    onProgress({ phase: 'modpack', label: `安装 ${loader.type} ${loader.version}…` });
    const res = await installLoader({
      type: loader.type,
      mcVersion,
      loaderVersion: loader.version,
      meta,
      root,
      javaPath,
      onProgress,
    });
    versionId = res.versionId;
    loaderVersion = res.loaderVersion;
  }
  instance = await instances.update(instance.id, { versionId, loaderVersion });

  onProgress({ phase: 'modpack', label: '安装游戏本体与依赖…' });
  await installer.install(versionId, { onProgress });

  const files = (index.files || []).filter((f) => f.env?.client !== 'unsupported');
  let done = 0;
  for (const f of files) {
    const dest = safeDest(instance.dir, f.path);
    await ensureDir(path.dirname(dest));
    const url = f.downloads?.[0];
    if (!url) continue;
    onProgress({ phase: 'modpack', label: `整合包文件 ${++done}/${files.length}: ${path.basename(f.path)}` });
    try {
      await downloadFile(url, dest, { sha1: f.hashes?.sha1, size: f.fileSize, timeout: 300000 });
    } catch (e) {
      onProgress({ phase: 'modpack', label: `跳过 ${path.basename(f.path)}: ${e.message}` });
    }
  }

  onProgress({ phase: 'modpack', label: '解压覆盖文件…' });
  for (const prefix of ['overrides/', 'client-overrides/']) {
    try {
      await extractZip(file, instance.dir, { filter: (n) => n.startsWith(prefix), strip: prefix });
    } catch (e) {
      onProgress({ phase: 'modpack', label: `覆盖文件解压失败: ${e.message}` });
    }
  }

  const modsCount = (await fsp.readdir(path.join(instance.dir, 'mods')).catch(() => [])).filter((f) => f.endsWith('.jar')).length;
  onProgress({ phase: 'modpack', label: `整合包安装完成，共 ${modsCount} 个模组` });
  return instance;
}
