import path from 'node:path';
import fsp from 'node:fs/promises';
import { downloadFile, ensureDir, exists, mavenPath, pool, readJson, statSafe, writeJson } from './util.js';
import { defaultRuleContext, matchesRules } from './rules.js';

const CONCURRENCY = 24;

function joinUrl(base, rel) {
  return `${String(base).replace(/\/+$/, '')}/${String(rel).replace(/^\/+/, '')}`;
}

/**
 * 按 Maven 坐标 group:artifact:classifier 去重，保留最后出现的版本。
 * 原版库在前、加载器库在后，所以加载器的 ASM 等依赖会覆盖原版版本，
 * 避免 Fabric 报 "duplicate ASM classes found on classpath"。
 */
export function dedupeLibraries(libs) {
  const map = new Map();
  for (const lib of libs) {
    if (!lib?.name) continue;
    const coords = String(lib.name).split('@')[0].split(':');
    if (coords.length < 3) continue;
    const key = `${coords[0]}:${coords[1]}:${coords[3] || ''}`;
    map.set(key, lib);
  }
  return [...map.values()];
}

/** Mojang 只发 x86_64 原生库；Linux ARM64 上替换成 Maven Central 的 arm64 版本。 */
export const ARM64_NATIVE_SUPPORT = process.platform === 'linux' && process.arch === 'arm64';

export function applyArchCompat(versionJson) {
  if (!ARM64_NATIVE_SUPPORT) return versionJson;
  const libraries = [];
  for (const lib of versionJson.libraries || []) {
    const name = lib.name || '';
    // jtracy 没有 arm64 原生包：主 jar 保留，只丢弃 x64 原生包
    if (/^com\.mojang:jtracy:.+:natives-/.test(name)) continue;
    if (name.endsWith(':natives-linux')) {
      const newName = `${name.slice(0, -':natives-linux'.length)}:natives-linux-arm64`;
      let rel;
      try {
        rel = mavenPath(newName);
      } catch {
        libraries.push(lib);
        continue;
      }
      libraries.push({
        ...lib,
        name: newName,
        downloads: {
          ...(lib.downloads || {}),
          artifact: { path: rel, url: `https://repo1.maven.org/maven2/${rel}` },
        },
      });
      continue;
    }
    libraries.push(lib);
  }
  return { ...versionJson, libraries };
}

export class VersionInstaller {
  constructor({ meta, root }) {
    this.meta = meta;
    this.root = root;
    this.shared = path.join(root, 'shared');
    this.librariesDir = path.join(this.shared, 'libraries');
    this.assetsDir = path.join(this.shared, 'assets');
    this.versionsDir = path.join(this.shared, 'versions');
    this.assetBase = meta.source.resources;
    this.libraryBase = meta.source.libraries;
  }

  /** 找到继承链最底层的原版版本 id（客户端 jar 由它提供）。 */
  async baseVersionId(id) {
    let cur = id;
    for (let i = 0; i < 8; i++) {
      const json = await this.meta.versionJson(cur);
      if (!json.inheritsFrom) return cur;
      cur = json.inheritsFrom;
    }
    return cur;
  }

  jarPath(versionId) {
    return path.join(this.versionsDir, versionId, `${versionId}.jar`);
  }

  async isInstalled(id) {
    const jsonFile = path.join(this.versionsDir, id, `${id}.json`);
    if (!(await exists(jsonFile))) return false;
    const baseId = await this.baseVersionId(id);
    return exists(this.jarPath(baseId));
  }

  /** 收集需要下载的文件清单（不落盘，便于 UI 预估体积）。 */
  async plan(id) {
    const json = applyArchCompat(await this.meta.resolve(id));
    const baseId = await this.baseVersionId(id);
    const baseJson = await this.meta.versionJson(baseId);
    const ctx = defaultRuleContext();
    const files = [];

    const client = baseJson.downloads?.client;
    if (client?.url) {
      files.push({
        kind: 'client',
        url: client.url,
        dest: this.jarPath(baseId),
        sha1: client.sha1,
        size: client.size,
      });
    }

    for (const lib of dedupeLibraries(json.libraries || [])) {
      if (!matchesRules(lib.rules, ctx)) continue;
      const artifact = this.libraryTask(lib, null);
      if (artifact) files.push({ kind: 'library', ...artifact });
      const nativeTask = this.nativeTask(lib, ctx);
      if (nativeTask) files.push({ kind: 'native', ...nativeTask });
    }

    const assetIndex = json.assetIndex;
    if (assetIndex?.url) {
      files.push({
        kind: 'asset-index',
        url: assetIndex.url,
        dest: path.join(this.assetsDir, 'indexes', `${assetIndex.id}.json`),
        sha1: assetIndex.sha1,
        size: assetIndex.size,
      });
    }

    const logFile = json.logging?.client?.file;
    if (logFile?.url) {
      files.push({
        kind: 'logging',
        url: logFile.url,
        dest: path.join(this.assetsDir, 'log_configs', logFile.id),
        sha1: logFile.sha1,
        size: logFile.size,
      });
    }

    return { versionJson: json, baseId, files };
  }

  libraryTask(lib, classifier) {
    const downloads = lib.downloads || {};
    if (!classifier) {
      const artifact = downloads.artifact;
      if (artifact?.path) {
        return { url: artifact.url, dest: path.join(this.librariesDir, artifact.path), sha1: artifact.sha1, size: artifact.size };
      }
      try {
        const rel = mavenPath(lib.name);
        return {
          url: joinUrl(lib.url || this.libraryBase, rel),
          dest: path.join(this.librariesDir, rel),
          sha1: lib.sha1,
          size: lib.size,
        };
      } catch {
        return null;
      }
    }
    const cls = downloads.classifiers?.[classifier];
    if (cls?.path) {
      return { url: cls.url, dest: path.join(this.librariesDir, cls.path), sha1: cls.sha1, size: cls.size };
    }
    const base = lib.name.includes('@') ? lib.name.slice(0, lib.name.lastIndexOf('@')) : lib.name;
    const parts = base.split(':');
    if (parts.length < 3) return null;
    const name = `${parts.slice(0, 3).join(':')}:${classifier}`;
    const rel = mavenPath(name);
    return { url: joinUrl(lib.url || this.libraryBase, rel), dest: path.join(this.librariesDir, rel), sha1: lib.sha1, size: lib.size };
  }

  nativeTask(lib, ctx) {
    if (!lib.natives) return null;
    const raw = lib.natives[ctx.osName];
    if (!raw) return null;
    const bits = process.arch === 'ia32' || process.arch === 'arm' ? '32' : '64';
    const classifier = raw.replace('${arch}', bits);
    return this.libraryTask(lib, classifier);
  }

  async install(id, { onProgress = () => {}, assets = true, natives = true, force = false } = {}) {
    const { versionJson, baseId, files } = await this.plan(id);
    const tasks = force ? files : files;
    let totalBytes = tasks.reduce((s, f) => s + (f.size || 0), 0);
    let doneBytes = 0;
    let doneFiles = 0;

    const report = (label, extra = {}) =>
      onProgress({ phase: 'download', label, done: doneFiles, total: tasks.length, bytesDone: doneBytes, bytesTotal: totalBytes, ...extra });

    report('准备下载');

    const failures = [];
    await pool(
      tasks,
      CONCURRENCY,
      async (task) => {
        if (task.kind === 'native' && !natives) return;
        try {
          const r = await downloadFile(task.url, task.dest, {
            sha1: task.sha1,
            size: task.size,
            onBytes: (n) => {
              doneBytes += n;
            },
          });
          if (r.skipped) doneBytes += task.size || 0;
        } catch (e) {
          failures.push({ ...task, error: e.message });
        } finally {
          doneFiles++;
          const f = path.basename(task.dest);
          report(`下载 ${f}`, { lastFile: f });
        }
      },
      () => {},
    );

    if (failures.length) {
      const first = failures.slice(0, 3).map((f) => `${path.basename(f.dest)}: ${f.error}`).join('; ');
      const err = new Error(`${failures.length} 个文件下载失败（${first}）`);
      err.failures = failures;
      throw err;
    }

    if (assets) {
      const index = await this.readAssetIndex(versionJson);
      if (index) await this.downloadAssets(index, onProgress);
    }

    await writeJson(path.join(this.versionsDir, id, '.installed.json'), {
      id,
      baseId,
      installedAt: new Date().toISOString(),
      files: tasks.length,
    });

    return { id, baseId, files: tasks.length, bytes: totalBytes };
  }

  async readAssetIndex(versionJson) {
    const ai = versionJson.assetIndex;
    if (!ai) return null;
    const file = path.join(this.assetsDir, 'indexes', `${ai.id}.json`);
    if (await exists(file)) {
      try {
        return await readJson(file);
      } catch {
        /* 重新下载 */
      }
    }
    if (!ai.url) return null;
    await downloadFile(ai.url, file, { sha1: ai.sha1, size: ai.size });
    return readJson(file);
  }

  async downloadAssets(index, onProgress = () => {}) {
    const objects = Object.values(index.objects || {});
    const tasks = objects.map((o) => ({
      hash: o.hash,
      size: o.size,
      dest: path.join(this.assetsDir, 'objects', o.hash.slice(0, 2), o.hash),
      url: joinUrl(this.assetBase, `${o.hash.slice(0, 2)}/${o.hash}`),
    }));

    let done = 0;
    let bytes = 0;
    const totalBytes = tasks.reduce((s, t) => s + (t.size || 0), 0);

    const failures = [];
    await pool(
      tasks,
      32,
      async (t) => {
        try {
          const r = await downloadFile(t.url, t.dest, { size: t.size, sha1: t.hash });
          if (r.skipped) bytes += t.size;
        } catch (e) {
          failures.push({ ...t, error: e.message });
        } finally {
          done++;
          if (done % 20 === 0 || done === tasks.length) {
            onProgress({
              phase: 'assets',
              label: `资源文件 ${done}/${tasks.length}`,
              done,
              total: tasks.length,
              bytesDone: bytes,
              bytesTotal: totalBytes,
            });
          }
        }
      },
      () => {},
    );
    if (failures.length) {
      const err = new Error(`${failures.length} 个资源文件下载失败`);
      err.failures = failures;
      throw err;
    }
  }

  /** 把旧版本（带 natives 映射的）原生库解压到实例目录。 */
  async extractNatives(versionJson, targetDir) {
    const ctx = defaultRuleContext();
    const jobs = [];
    for (const lib of dedupeLibraries(versionJson.libraries || [])) {
      if (!matchesRules(lib.rules, ctx)) continue;
      const task = this.nativeTask(lib, ctx);
      if (!task) continue;
      const exclude = lib.extract?.exclude || [];
      jobs.push({ jar: task.dest, exclude });
    }
    if (!jobs.length) return 0;
    await ensureDir(targetDir);
    const { extractZip } = await import('./zip.js');
    let count = 0;
    for (const job of jobs) {
      if (!(await exists(job.jar))) continue;
      const patterns = job.exclude.map((p) => new RegExp(`^${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}.*`));
      const r = await extractZip(job.jar, targetDir, {
        filter: (name) => !name.endsWith('/') && !patterns.some((re) => re.test(name)),
      });
      count += r.files;
    }
    return count;
  }

  /** 删除整个版本（只删实例版本目录，不动共享库）。 */
  async uninstall(id) {
    await fsp.rm(path.join(this.versionsDir, id), { recursive: true, force: true });
  }

  async diskUsage() {
    const size = async (dir) => {
      let total = 0;
      const walk = async (d) => {
        let entries;
        try {
          entries = await fsp.readdir(d, { withFileTypes: true });
        } catch {
          return;
        }
        for (const e of entries) {
          const p = path.join(d, e.name);
          if (e.isDirectory()) await walk(p);
          else {
            const st = await statSafe(p);
            if (st) total += st.size;
          }
        }
      };
      await walk(dir);
      return total;
    };
    return {
      libraries: await size(this.librariesDir),
      assets: await size(this.assetsDir),
      versions: await size(this.versionsDir),
    };
  }
}
