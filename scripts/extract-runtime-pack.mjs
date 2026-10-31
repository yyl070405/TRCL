// 从 FCL APK 里抽出 Android 运行时，打成我们自己的 runtime pack。
// 用法: node scripts/extract-runtime-pack.mjs /path/FCL.apk [outDir]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readZipEntries, readEntryData } from '../src/core/zip.js';

const apk = process.argv[2];
const outDir = process.argv[3] || path.resolve('dist/runtime-pack');
if (!apk || !fs.existsSync(apk)) {
  console.error('用法: node scripts/extract-runtime-pack.mjs <FCL.apk> [outDir]');
  process.exit(1);
}

const WANT = [
  /^assets\/app_runtime\/java\/jre(17|21|25)\//,
  /^assets\/app_runtime\/lwjgl\/3\.(3\.3|4\.1)\//,
  /^assets\/app_runtime\/jna\//,
  /^assets\/game\/(MioLaunchWrapper|MioLibPatcher)\.jar$/,
  /^assets\/licenses\//,
  /^lib\/arm64-v8a\/(libmobileglues|libEGL_angle|libGLESv2_angle|libgl4es_114|libng_gl4es|libspirv-cross-c-shared|libvk|libvulkan_freedreno|libzink_dri)\.so$/,
];

const buf = fs.readFileSync(apk);
const entries = readZipEntries(buf);
const picked = entries.filter((e) => !e.isDir && WANT.some((re) => re.test(e.name)));
if (!picked.length) {
  console.error('APK 里没有匹配的运行时条目');
  process.exit(1);
}

let bytes = 0;
for (const entry of picked) {
  const dest = path.join(outDir, entry.name);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const data = readEntryData(buf, entry);
  fs.writeFileSync(dest, data);
  bytes += data.length;
}
console.log(`extracted ${picked.length} files, ${(bytes / 1048576).toFixed(1)} MB -> ${outDir}`);

// 打成一个包，方便上传到自己的域名/对象存储
const tarPath = path.resolve('dist', `mc-runtime-arm64-${new Date().toISOString().slice(0, 10)}.tar.gz`);
fs.mkdirSync(path.dirname(tarPath), { recursive: true });
execFileSync('tar', ['-czf', tarPath, '-C', outDir, '.'], { stdio: 'inherit' });

const hash = crypto.createHash('sha256');
hash.update(fs.readFileSync(tarPath));
const size = fs.statSync(tarPath).size;
const manifest = {
  components: [
    {
      id: 'runtime-arm64',
      name: 'Android 运行时（JRE + LWJGL + MobileGlues）',
      version: new Date().toISOString().slice(0, 10),
      kind: 'tar.gz',
      sha256: hash.digest('hex'),
      size,
      urls: [`https://863214.xyz/runtime/${path.basename(tarPath)}`],
    },
  ],
};
fs.writeFileSync(path.resolve('dist', 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`pack: ${tarPath}`);
console.log(`sha256: ${manifest.components[0].sha256}  size: ${(size / 1048576).toFixed(1)} MB`);
console.log('把 tar.gz 和 manifest.json 上传到 863214.xyz/runtime/ 即可。');
