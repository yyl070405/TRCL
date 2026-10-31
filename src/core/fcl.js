import path from 'node:path';
import fsp from 'node:fs/promises';
import { ensureDir, exists, pool, readJson, writeJson } from './util.js';

export const DEFAULT_FCL_ROOTS = [
  '/sdcard/FCL/.minecraft',
  '/storage/emulated/0/FCL/.minecraft',
  '/root/手机存储/FCL/.minecraft',
];

export async function detectFclRoot(explicit) {
  if (explicit) return explicit;
  if (process.env.FCL_HOME) return process.env.FCL_HOME;
  for (const p of DEFAULT_FCL_ROOTS) {
    if (await exists(path.join(p, 'versions'))) return p;
  }
  return null;
}

async function walkFiles(dir) {
  const out = [];
  const walk = async (rel) => {
    let entries;
    try {
      entries = await fsp.readdir(path.join(dir, rel), { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const relPath = rel ? path.join(rel, e.name) : e.name;
      if (e.isDirectory()) await walk(relPath);
      else out.push(relPath);
    }
  };
  await walk('');
  return out;
}

/** 增量合并目录：只补缺失文件，不覆盖、不删除。 */
async function mergeCopy(src, dest, { onProgress, label, concurrency = 16 } = {}) {
  if (!(await exists(src))) return { files: 0, bytes: 0 };
  const rels = await walkFiles(src);
  let files = 0;
  let bytes = 0;
  await pool(
    rels,
    concurrency,
    async (rel) => {
      const target = path.join(dest, rel);
      if (await exists(target)) return;
      await ensureDir(path.dirname(target));
      await fsp.copyFile(path.join(src, rel), target);
      const st = await fsp.stat(target);
      files++;
      bytes += st.size;
      if (files % 50 === 0) onProgress?.({ label: `${label} ${files}/${rels.length}`, done: files, total: rels.length });
    },
    () => {},
  );
  return { files, bytes };
}

/** 找一份现成的 fclversion.cfg 作为渲染器模板（取最新修改的）。 */
async function pickSettingTemplate(fclRoot) {
  const versionsDir = path.join(fclRoot, 'versions');
  let best = null;
  let bestTime = 0;
  let dirs = [];
  try {
    dirs = await fsp.readdir(versionsDir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    const file = path.join(versionsDir, d.name, 'fclversion.cfg');
    try {
      const st = await fsp.stat(file);
      if (st.mtimeMs > bestTime) {
        bestTime = st.mtimeMs;
        best = await readJson(file);
      }
    } catch {
      /* 跳过没有配置的版本 */
    }
  }
  return best;
}

export function buildFclSetting(instance, template) {
  const cfg = {
    usesGlobal: false,
    javaArgs: '',
    minecraftArgs: '',
    maxMemory: instance.memoryMb || 2048,
    autoMemory: false,
    minMemory: null,
    serverIp: '',
    java: 'Auto',
    notCheckGame: false,
    notCheckJVM: false,
    graphicsBackend: template?.graphicsBackend ?? 'default',
    vulkanDriverSystem: template?.vulkanDriverSystem ?? true,
    controller: '00000000',
    isolateGameDir: true,
    notCheckMod: false,
    notCheckVulkan: template?.notCheckVulkan ?? true,
    debugLog: false,
  };
  // 继承已验证可用的渲染器，避免落到默认 NGGL4ES
  if (template?.renderer) cfg.renderer = template.renderer;
  if (template?.driver) cfg.driver = template.driver;
  return cfg;
}

/**
 * 把实例导出到 FCL 的 .minecraft 目录。
 * 只新增文件，不覆盖已有版本，不删除任何东西。
 */
export async function exportToFcl({
  instance,
  meta,
  root,
  fclRoot,
  onProgress = () => {},
  assets = true,
  libraries = true,
  merge = false,
}) {
  const target = await detectFclRoot(fclRoot);
  if (!target) throw new Error('没有找到 FCL 数据目录（默认 /sdcard/FCL/.minecraft），可用 --fcl 指定');

  const versionId = instance.versionId || instance.mcVersion;
  const destVersionDir = path.join(target, 'versions', versionId);
  if ((await exists(path.join(destVersionDir, `${versionId}.json`))) && !merge) {
    throw new Error(`FCL 里已经有版本 ${versionId}，不覆盖。用 merge 模式补齐缺失文件，或先删掉它。`);
  }

  // 版本继承链：加载器 + 原版都要在 FCL 的 versions 里
  const chain = [];
  let cur = versionId;
  for (let i = 0; i < 6; i++) {
    chain.push(cur);
    const json = await meta.versionJson(cur);
    if (!json.inheritsFrom) break;
    cur = json.inheritsFrom;
  }

  const shared = path.join(root, 'shared');
  let copiedFiles = 0;
  let copiedBytes = 0;

  onProgress({ phase: 'fcl', label: '复制版本文件…' });
  for (const id of chain) {
    const src = path.join(shared, 'versions', id);
    const dest = path.join(target, 'versions', id);
    const rels = (await walkFiles(src)).filter((r) => !r.endsWith('.installed.json'));
    await pool(rels, 8, async (rel) => {
      const out = path.join(dest, rel);
      if (await exists(out)) return;
      await ensureDir(path.dirname(out));
      await fsp.copyFile(path.join(src, rel), out);
      copiedFiles++;
      copiedBytes += (await fsp.stat(out)).size;
    });
  }

  // FCL 的 getVersionJar() 取 v.getJar() || v.getId()，加载器版本没有同名 jar，
  // 必须用 Mojang 的 jar 字段指到原版，否则它会去找 <loaderId>.jar 而失败。
  const loaderJsonPath = path.join(destVersionDir, `${versionId}.json`);
  const loaderJson = await readJson(loaderJsonPath, null);
  if (loaderJson?.inheritsFrom && !loaderJson.jar) {
    await writeJson(loaderJsonPath, { ...loaderJson, jar: loaderJson.inheritsFrom });
  }

  if (libraries) {
    onProgress({ phase: 'fcl', label: '同步 libraries…' });
    const r = await mergeCopy(path.join(shared, 'libraries'), path.join(target, 'libraries'), {
      onProgress,
      label: 'libraries',
    });
    copiedFiles += r.files;
    copiedBytes += r.bytes;
  }

  if (assets) {
    onProgress({ phase: 'fcl', label: '同步 assets（可能较慢）…' });
    const r = await mergeCopy(path.join(shared, 'assets'), path.join(target, 'assets'), {
      onProgress,
      label: 'assets',
      concurrency: 24,
    });
    copiedFiles += r.files;
    copiedBytes += r.bytes;
  }

  // FCL 的 isolateGameDir=true：游戏目录就是版本目录，实例的模组/配置要一起搬
  for (const sub of ['mods', 'config']) {
    const r = await mergeCopy(path.join(instance.dir, sub), path.join(destVersionDir, sub), {
      onProgress,
      label: sub,
      concurrency: 8,
    });
    copiedFiles += r.files;
    copiedBytes += r.bytes;
  }

  const template = await pickSettingTemplate(target);
  const setting = buildFclSetting(instance, template);
  await ensureDir(destVersionDir);
  await writeJson(path.join(destVersionDir, 'fclversion.cfg'), setting);

  onProgress({
    phase: 'fcl',
    label: `已导出到 FCL：${versionId}（${copiedFiles} 个文件）`,
    done: 1,
    total: 1,
  });

  return {
    fclRoot: target,
    versionId,
    chain,
    files: copiedFiles,
    bytes: copiedBytes,
    renderer: setting.renderer || 'default',
    setting,
  };
}
