import fsp from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { ensureDir } from './util.js';

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;
const LOC_SIG = 0x04034b50;

/** 读取 ZIP 中央目录（不支持 ZIP64，Minecraft 资源用不到）。 */
export function readZipEntries(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('不是有效的 ZIP 文件（找不到 EOCD）');
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const entries = [];
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(off) !== CEN_SIG) throw new Error('ZIP 中央目录损坏');
    const method = buf.readUInt16LE(off + 10);
    const crc = buf.readUInt32LE(off + 16);
    const compressedSize = buf.readUInt32LE(off + 20);
    const size = buf.readUInt32LE(off + 24);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localOffset = buf.readUInt32LE(off + 42);
    const name = buf.toString('utf8', off + 46, off + 46 + nameLen).replace(/\\/g, '/');
    entries.push({ name, method, crc, compressedSize, size, localOffset, isDir: name.endsWith('/') });
    off += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

export function readEntryData(buf, entry) {
  const lh = entry.localOffset;
  if (buf.readUInt32LE(lh) !== LOC_SIG) throw new Error(`ZIP 本地头损坏: ${entry.name}`);
  const nameLen = buf.readUInt16LE(lh + 26);
  const extraLen = buf.readUInt16LE(lh + 28);
  const start = lh + 30 + nameLen + extraLen;
  const raw = buf.subarray(start, start + entry.compressedSize);
  if (entry.method === 0) return raw;
  if (entry.method === 8) return zlib.inflateRawSync(raw);
  throw new Error(`不支持的 ZIP 压缩方式 ${entry.method}: ${entry.name}`);
}

/** 防目录穿越：确保 target 落在 destDir 内。 */
function safeJoin(destDir, name) {
  const full = path.resolve(destDir, name);
  const root = path.resolve(destDir) + path.sep;
  if (!full.startsWith(root) && full !== path.resolve(destDir)) {
    throw new Error(`ZIP 内路径越界: ${name}`);
  }
  return full;
}

export async function extractZip(zipPath, destDir, { filter, strip } = {}) {
  const buf = await fsp.readFile(zipPath);
  const entries = readZipEntries(buf);
  let files = 0;
  for (const entry of entries) {
    if (entry.isDir) continue;
    if (filter && !filter(entry.name)) continue;
    let name = entry.name;
    if (strip && name.startsWith(strip)) name = name.slice(strip.length);
    if (!name || name.endsWith('/')) continue;
    const target = safeJoin(destDir, name);
    await ensureDir(path.dirname(target));
    await fsp.writeFile(target, readEntryData(buf, entry));
    files++;
  }
  return { files };
}

/** 读取 ZIP 里的单个文件（用于解析 mod 元数据）。 */
export async function readZipEntry(zipPath, name) {
  let buf;
  try {
    buf = await fsp.readFile(zipPath);
  } catch {
    return null;
  }
  const entry = readZipEntries(buf).find((e) => e.name === name);
  if (!entry) return null;
  return readEntryData(buf, entry);
}

/** 解析 .tar.gz（Adoptium 的 macOS/Linux JRE 用这个格式）。 */
export async function extractTarGz(archivePath, destDir) {
  const gz = await fsp.readFile(archivePath);
  const buf = zlib.gunzipSync(gz);
  let off = 0;
  let files = 0;
  let longName = null;
  while (off + 512 <= buf.length) {
    const header = buf.subarray(off, off + 512);
    if (header.every((b) => b === 0)) break;
    const rawName = header.toString('utf8', 0, 100).replace(/\0.*$/, '');
    const sizeStr = header.toString('utf8', 124, 136).replace(/\0.*$/, '').trim();
    const size = parseInt(sizeStr, 8) || 0;
    const type = String.fromCharCode(header[156] || 48);
    const prefix = header.toString('utf8', 345, 500).replace(/\0.*$/, '');
    let name = prefix ? `${prefix}/${rawName}` : rawName;
    if (longName) {
      name = longName;
      longName = null;
    }
    const dataOff = off + 512;
    if (type === 'L') {
      longName = buf.toString('utf8', dataOff, dataOff + size).replace(/\0.*$/, '');
    } else if (type === '0' || type === '\0' || type === '7') {
      if (!name.endsWith('/')) {
        const target = safeJoin(destDir, name);
        await ensureDir(path.dirname(target));
        await fsp.writeFile(target, buf.subarray(dataOff, dataOff + size));
        files++;
      }
    }
    off = dataOff + Math.ceil(size / 512) * 512;
  }
  return { files };
}
