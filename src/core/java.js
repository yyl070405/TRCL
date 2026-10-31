import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { downloadFile, ensureDir, exists, fetchJson, fetchText, formatBytes, isMac, isWindows, removeSafe } from './util.js';
import { extractTarGz, extractZip } from './zip.js';

const execFileAsync = promisify(execFile);
const JAVA_BIN = isWindows ? 'java.exe' : 'java';

export async function probeJava(javaPath, timeout = 20000) {
  try {
    const { stdout, stderr } = await execFileAsync(javaPath, ['-XshowSettings:properties', '-version'], {
      timeout,
      windowsHide: true,
      maxBuffer: 2 * 1024 * 1024,
    });
    const text = `${stdout}\n${stderr}`;
    const pick = (key) => text.match(new RegExp(`^\\s*${key}\\s*=\\s*(.+)$`, 'm'))?.[1]?.trim();
    const version =
      pick('java.version') || text.match(/version "([^"]+)"/)?.[1] || text.match(/openjdk (\S+)/i)?.[1] || '';
    const home = pick('java.home') || '';
    const arch = pick('os.arch') || '';
    const major = version.startsWith('1.') ? Number(version.split('.')[1]) : Number(version.split('.')[0]);
    return {
      path: javaPath,
      version,
      major: Number.isFinite(major) ? major : null,
      home,
      arch,
      vendor: pick('java.vendor'),
    };
  } catch (e) {
    return null;
  }
}

async function tryCandidates(dirs) {
  const out = [];
  for (const dir of dirs) {
    const bin = path.join(dir, 'bin', JAVA_BIN);
    if (await exists(bin)) out.push(bin);
  }
  return out;
}

async function expandGlobs(parents) {
  const out = [];
  for (const parent of parents) {
    let entries;
    try {
      entries = await fsp.readdir(parent, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const base = path.join(parent, e.name);
      out.push(base);
      if (isMac) out.push(path.join(base, 'Contents', 'Home'));
    }
  }
  return out;
}

/** 找出机器上所有可用的 Java。 */
export async function findJavas(root) {
  const explicit = [];
  if (process.env.JAVA_HOME) explicit.push(path.join(process.env.JAVA_HOME, 'bin', JAVA_BIN));

  const pathDirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const d of pathDirs) explicit.push(path.join(d, JAVA_BIN));

  let runtimes = [];
  try {
    const entries = await fsp.readdir(path.join(root, 'runtime'), { withFileTypes: true });
    for (const e of entries) {
      if (e.isDirectory()) runtimes.push(path.join(root, 'runtime', e.name, 'bin', JAVA_BIN));
    }
  } catch {
    /* none */
  }

  let standard = [];
  if (isWindows) {
    standard = await expandGlobs([
      'C:\\Program Files\\Java',
      'C:\\Program Files\\Eclipse Adoptium',
      'C:\\Program Files\\Microsoft',
      path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Eclipse Adoptium'),
      path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Java'),
    ]);
  } else if (isMac) {
    standard = await expandGlobs(['/Library/Java/JavaVirtualMachines', path.join(os.homedir(), 'Library/Java/JavaVirtualMachines')]);
  } else {
    standard = await expandGlobs(['/usr/lib/jvm', '/usr/java', '/opt/java']);
  }
  standard = await tryCandidates(standard);

  const candidates = [...new Set([...runtimes, ...standard, ...explicit])];
  const probed = [];
  for (const p of candidates) {
    const info = await probeJava(p);
    if (info?.major) probed.push(info);
  }
  const seen = new Set();
  return probed.filter((j) => {
    const key = j.home || j.path;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** 按 MC 需求挑一个 Java；返回 {java, compatible}。 */
export function chooseJava(list, requiredMajor) {
  if (!list.length) return { java: null, compatible: false };
  const exact = list.find((j) => j.major === requiredMajor);
  if (exact) return { java: exact, compatible: true };
  if (requiredMajor >= 17) {
    const higher = list.filter((j) => j.major > requiredMajor).sort((a, b) => a.major - b.major)[0];
    if (higher) return { java: higher, compatible: true };
  }
  const best = [...list].sort((a, b) => Math.abs(a.major - requiredMajor) - Math.abs(b.major - requiredMajor))[0];
  return { java: best, compatible: false };
}

function adoptiumUrl(major) {
  const archMap = { x64: 'x64', arm64: 'aarch64', ia32: 'x86' };
  const osMap = { win32: 'windows', darwin: 'mac', linux: 'linux' };
  const arch = archMap[process.arch] || 'x64';
  const platform = osMap[process.platform] || 'linux';
  return { base: `https://mirrors.tuna.tsinghua.edu.cn/Adoptium/${major}/jre/${arch}/${platform}/`, arch, platform };
}

async function pickArchive(baseUrl, platform) {
  const html = await fetchText(baseUrl, { timeout: 20000 });
  const names = [...new Set(html.match(/OpenJDK[0-9]+U-jre_[^"'<>]+?\.(?:zip|tar\.gz)/g) || [])];
  if (!names.length) throw new Error('镜像目录里没有找到 JRE 安装包');
  const wantZip = platform === 'windows';
  const sorted = names.sort().reverse();
  return sorted.find((n) => (wantZip ? n.endsWith('.zip') : n.endsWith('.tar.gz'))) || sorted[0];
}

async function findJavaHome(dir, depth = 0) {
  if (depth > 3) return null;
  const direct = path.join(dir, 'bin', JAVA_BIN);
  if (await exists(direct)) return dir;
  let entries = [];
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const found = await findJavaHome(path.join(dir, e.name), depth + 1);
    if (found) return found;
  }
  return null;
}

/**
 * 从清华 Adoptium 镜像下载并解压指定大版本 JRE（Windows/macOS/Linux 都支持）。
 */
export async function installJre(major, { root, onProgress = () => {} }) {
  const { base, arch, platform } = adoptiumUrl(major);
  const target = path.join(root, 'runtime', `jre-${major}-${platform}-${arch}`);
  const existing = path.join(target, 'bin', JAVA_BIN);
  if (await exists(existing)) return probeJava(existing);

  onProgress({ phase: 'jre', label: `查找 Java ${major} 安装包…` });
  let archiveName;
  let archiveUrl;
  try {
    archiveName = await pickArchive(base, platform);
    archiveUrl = base + archiveName;
  } catch (mirrorError) {
    onProgress({ phase: 'jre', label: '镜像不可用，尝试 Adoptium 官方源…' });
    const osMap = { windows: 'windows', mac: 'mac', linux: 'linux' };
    const api =
      `https://api.adoptium.net/v3/assets/latest/${major}/hotspot` +
      `?architecture=${encodeURIComponent(arch)}&image_type=jre&os=${osMap[platform] || platform}&vendor=eclipse`;
    const list = await fetchJson(api, { timeout: 25000 });
    const pkg = list?.[0]?.binary?.package;
    if (!pkg?.link) throw new Error(`找不到 Java ${major} 安装包：${mirrorError.message}`);
    archiveName = pkg.name;
    archiveUrl = pkg.link;
  }
  const downloadDir = path.join(root, 'runtime', '.downloads');
  await ensureDir(downloadDir);
  const archivePath = path.join(downloadDir, archiveName);

  const size = await sizeOf(archiveUrl);
  onProgress({ phase: 'jre', label: `下载 ${archiveName}${size ? ` (${formatBytes(size)})` : ''}`, done: 0, total: 1 });
  await downloadFile(archiveUrl, archivePath, {
    timeout: 600000,
    onBytes: (n, total) => onProgress({ phase: 'jre', label: `下载 Java ${major}`, bytesDone: n, bytesTotal: total || size || 0 }),
  });

  onProgress({ phase: 'jre', label: '解压 Java…' });
  const temp = path.join(root, 'runtime', `.tmp-jre-${major}-${Date.now()}`);
  await ensureDir(temp);
  if (archiveName.endsWith('.zip')) await extractZip(archivePath, temp);
  else await extractTarGz(archivePath, temp);

  const home = await findJavaHome(temp);
  if (!home) throw new Error('解压后找不到 bin/java，安装包可能损坏');
  await removeSafe(target);
  await ensureDir(path.dirname(target));
  await fsp.rename(home, target);
  await removeSafe(temp);
  await removeSafe(archivePath);

  const info = await probeJava(path.join(target, 'bin', JAVA_BIN));
  if (!info) throw new Error('Java 安装完成但无法执行');
  onProgress({ phase: 'jre', label: `Java ${info.version} 就绪`, done: 1, total: 1 });
  return info;
}

async function sizeOf(url) {
  try {
    const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(15000) });
    const n = Number(res.headers.get('content-length') || 0);
    return n || null;
  } catch {
    return null;
  }
}
