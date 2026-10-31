import path from 'node:path';
import fsp from 'node:fs/promises';
import { downloadFile, ensureDir, exists, fetchJson, findJavaHome, formatBytes, javaBinOf, removeSafe } from './util.js';
import { extractTarGz, extractZip } from './zip.js';

const API = 'https://api.azul.com/metadata/v1/zulu/packages/';

/** 下载器覆盖的 Java 大版本（Minecraft 各版本用到的都在里面）。 */
export const ZULU_MAJORS = [8, 11, 16, 17, 21, 25];

const OS_NAMES = { win32: 'windows', darwin: 'macos', linux: 'linux' };
const ARCH_NAMES = { x64: 'x64', arm64: 'aarch64', ia32: 'x86', arm: 'arm' };
const NAME_OS = { windows: 'win', macos: 'macosx', linux: 'linux' };

/** 本机对应的 Zulu 平台参数。 */
export function zuluTarget(platform = process.platform, arch = process.arch) {
  const os = OS_NAMES[platform] || 'linux';
  return { os, arch: ARCH_NAMES[arch] || 'x64', archiveType: os === 'windows' ? 'zip' : 'tar.gz' };
}

/** Zulu 元数据接口地址（纯函数）。 */
export function zuluQuery(major, target = zuluTarget(), packageType = 'jre') {
  const query = new URLSearchParams({
    java_version: String(major),
    os: target.os,
    arch: target.arch,
    archive_type: target.archiveType,
    java_package_type: packageType,
    release_status: 'ga',
    availability_types: 'CA',
    latest: 'false',
    page_size: '100',
  });
  return `${API}?${query}`;
}

function versionWeight(pkg) {
  const v = Array.isArray(pkg?.java_version) ? pkg.java_version : [];
  return v.reduce((acc, n, i) => acc + (Number(n) || 0) / 100 ** i, 0);
}

/**
 * 纯函数：从 Zulu 返回的包列表里挑一个。
 * 规则：匹配平台/架构、排除 CRaC / JavaFX / musl 变体，取版本最高的那个。
 */
export function pickZuluPackage(list, target) {
  const osToken = NAME_OS[target.os] || target.os;
  const suffix = `.${target.archiveType}`;
  const candidates = (Array.isArray(list) ? list : []).filter((pkg) => {
    const name = pkg?.name || '';
    if (!pkg?.download_url || !name.endsWith(suffix)) return false;
    if (!name.includes(`${osToken}_${target.arch}`)) return false;
    if (name.includes('-crac-') || name.includes('-fx-')) return false;
    if (name.includes('-musl-')) return false;
    return true;
  });
  candidates.sort((a, b) => versionWeight(b) - versionWeight(a));
  return candidates[0] || null;
}

/** 已安装的 Zulu 运行时目录名。 */
export function zuluDirName(major, target) {
  return `zulu-${major}-${target.os}-${target.arch}`;
}

/**
 * 下载并解压 Zulu。返回 { home, bin }，不做版本探测，由调用方 probeJava。
 * packageType: 'jre' | 'jdk'；JRE 找不到时自动退回 JDK。
 */
export async function installZuluJava(major, { root, onProgress = () => {}, packageType = 'jre', target = zuluTarget() } = {}) {
  const finalDir = path.join(root, 'runtime', zuluDirName(major, target));
  const existingBin = javaBinOf(finalDir);
  if (await exists(existingBin)) return { home: finalDir, bin: existingBin };

  let pkg;
  let usedType = packageType;
  for (const type of [packageType, packageType === 'jre' ? 'jdk' : 'jre']) {
    onProgress({ phase: 'jre', label: `查询 Zulu ${major}（${type.toUpperCase()}）…` });
    const list = await fetchJson(zuluQuery(major, target, type), { timeout: 30000 });
    pkg = pickZuluPackage(list, target);
    if (pkg) {
      usedType = type;
      break;
    }
  }
  if (!pkg) throw new Error(`Zulu 没有 Java ${major} 的 ${target.os}/${target.arch} 包`);

  const downloadDir = path.join(root, 'runtime', '.downloads');
  await ensureDir(downloadDir);
  const archivePath = path.join(downloadDir, pkg.name);

  onProgress({ phase: 'jre', label: `下载 ${pkg.name}${pkg.size ? ` (${formatBytes(pkg.size)})` : ''}` });
  await downloadFile(pkg.download_url, archivePath, {
    timeout: 900000,
    onBytes: (n, total) =>
      onProgress({ phase: 'jre', label: `下载 Zulu ${major} ${usedType.toUpperCase()}`, bytesDone: n, bytesTotal: total || 0 }),
  });

  onProgress({ phase: 'jre', label: '解压 Java…' });
  const temp = path.join(root, 'runtime', `.tmp-${zuluDirName(major, target)}-${Date.now()}`);
  await ensureDir(temp);
  if (pkg.name.endsWith('.zip')) await extractZip(archivePath, temp);
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
