import path from 'node:path';
import fsp from 'node:fs/promises';
import { downloadFile, ensureDir, exists, fetchText, findJavaHome, formatBytes, javaBinOf, removeSafe } from './util.js';
import { extractTarGz, extractZip } from './zip.js';

const DOWNLOADS_PAGE = 'https://www.oracle.com/java/technologies/downloads/';
const URL_RE = /https:\/\/download\.oracle\.com\/[^\s"'<>]*?\/(jre|jdk)-([0-9][0-9a-z.]*)[-_]([a-z0-9]+-[a-z0-9]+)(?:_bin)?\.(tar\.gz|zip)/g;

const OS_TOKEN = { win32: 'windows', darwin: 'macos', linux: 'linux' };
const ARCH_TOKEN = { x64: 'x64', arm64: 'aarch64', ia32: 'i586' };

/** 本机对应的 Oracle 平台参数。 */
export function oracleTarget(platform = process.platform, arch = process.arch) {
  const os = OS_TOKEN[platform] || 'linux';
  return { os, arch: ARCH_TOKEN[arch] || 'x64', ext: os === 'windows' ? 'zip' : 'tar.gz' };
}

/**
 * 纯函数：从 Oracle 下载页 HTML 里抽出所有安装包链接。
 * 返回 [{ kind: 'jre'|'jdk', major, version, url, os, arch, ext }]
 */
export function parseOracleLinks(html) {
  const out = [];
  const text = String(html || '');
  const re = new RegExp(URL_RE.source, 'g');
  let m;
  while ((m = re.exec(text))) {
    const [url, kind, version, plat] = m;
    const dash = plat.lastIndexOf('-');
    const os = plat.slice(0, dash).replace('macosx', 'macos');
    const arch = plat.slice(dash + 1);
    const major = parseInt(version, 10);
    if (!Number.isFinite(major)) continue;
    out.push({ kind, major, version, url, os, arch, ext: url.endsWith('.zip') ? 'zip' : 'tar.gz' });
  }
  return out;
}

function versionWeight(pkg) {
  return String(pkg.version)
    .split('.')
    .reduce((acc, n, i) => acc + (Number(n) || 0) / 100 ** i, 0);
}

/**
 * 纯函数：按大版本、平台、架构挑一个包。JRE 优先（比 JDK 小一半），没有再退 JDK。
 */
export function pickOraclePackage(links, target, major, preferJre = true) {
  const match = (links || []).filter(
    (p) => p.major === Number(major) && p.os === target.os && p.arch === target.arch && p.ext === target.ext,
  );
  const order = preferJre ? ['jre', 'jdk'] : ['jdk', 'jre'];
  for (const kind of order) {
    const list = match.filter((p) => p.kind === kind).sort((a, b) => versionWeight(b) - versionWeight(a));
    if (list.length) return list[0];
  }
  return null;
}

/** 下载页上的 `/java/<大版本>/latest/` 直链（只有当前 GA 版本有）。 */
export function latestUrl(major, target) {
  return `https://download.oracle.com/java/${major}/latest/jdk-${major}_${target.os}-${target.arch}_bin.${target.ext}`;
}

/** 纯函数：判断下载到的文件是安装包还是被换成的登录页。 */
export function isArchiveMagic(head, name) {
  if (!head || head.length < 4) return false;
  if (String(name).endsWith('.zip')) return head[0] === 0x50 && head[1] === 0x4b;
  return head[0] === 0x1f && head[1] === 0x8b;
}

export function oracleDirName(major, target) {
  return `oracle-${major}-${target.os}-${target.arch}`;
}

/**
 * 下载 Oracle 官方 JDK。匿名直链只覆盖当前 GA 版本，老版本会跳到登录页，
 * 这时抛错，由 java.js 的下载链退回 Zulu。
 */
export async function installOracleJava(major, { root, onProgress = () => {}, target = oracleTarget() } = {}) {
  const finalDir = path.join(root, 'runtime', oracleDirName(major, target));
  const existingBin = javaBinOf(finalDir);
  if (await exists(existingBin)) return { home: finalDir, bin: existingBin };

  onProgress({ phase: 'jre', label: `查询 Oracle Java ${major}…` });
  const candidates = [latestUrl(major, target)];
  try {
    const html = await fetchText(DOWNLOADS_PAGE, { timeout: 40000 });
    const pkg = pickOraclePackage(parseOracleLinks(html), target, major, false);
    if (pkg?.url) candidates.push(pkg.url);
  } catch {
    /* 页面拉不到就只试 latest 直链 */
  }

  let picked = null;
  for (const url of candidates) {
    const info = await probeUrl(url);
    if (info) {
      picked = { ...info, name: path.basename(decodeURIComponent(url)) };
      break;
    }
  }
  if (!picked) {
    throw new Error(`Oracle 只对最新版提供匿名直链，Java ${major} 需要登录 oracle.com 才能下载`);
  }

  const downloadDir = path.join(root, 'runtime', '.downloads');
  await ensureDir(downloadDir);
  const archivePath = path.join(downloadDir, picked.name);

  onProgress({ phase: 'jre', label: `下载 Oracle JDK ${major}${picked.size ? ` (${formatBytes(picked.size)})` : ''}` });
  await downloadFile(picked.url, archivePath, {
    timeout: 1800000,
    onBytes: (n, total) =>
      onProgress({ phase: 'jre', label: `下载 Oracle Java ${major}`, bytesDone: n, bytesTotal: total || picked.size || 0 }),
  });

  if (!(await looksLikeArchive(archivePath))) {
    await removeSafe(archivePath);
    throw new Error('Oracle 返回的是登录页而不是安装包');
  }

  onProgress({ phase: 'jre', label: '解压 Java…' });
  const temp = path.join(root, 'runtime', `.tmp-${oracleDirName(major, target)}-${Date.now()}`);
  await ensureDir(temp);
  if (picked.name.endsWith('.zip')) await extractZip(archivePath, temp);
  else await extractTarGz(archivePath, temp);

  const home = await findJavaHome(temp);
  if (!home) throw new Error('解压后找不到 bin/java，安装包可能不完整');
  await removeSafe(finalDir);
  await ensureDir(path.dirname(finalDir));
  await fsp.rename(home, finalDir);
  await removeSafe(temp);
  await removeSafe(archivePath);

  return { home: finalDir, bin: javaBinOf(finalDir) };
}

async function probeUrl(url) {
  try {
    const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(20000), redirect: 'follow' });
    const type = res.headers.get('content-type') || '';
    const size = Number(res.headers.get('content-length') || 0);
    if (res.status !== 200 || type.includes('text/html') || size < 1024 * 1024) return null;
    return { url, size };
  } catch {
    return null;
  }
}

async function looksLikeArchive(file) {
  let fh;
  try {
    fh = await fsp.open(file, 'r');
    const buf = Buffer.alloc(4);
    await fh.read(buf, 0, 4, 0);
    return isArchiveMagic(buf, file);
  } catch {
    return false;
  } finally {
    await fh?.close();
  }
}
