// 生成 PWA 图标（无第三方依赖，手写 PNG）。
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '..', 'ui');

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function draw(size) {
  const px = Buffer.alloc(size * size * 4);
  const r = size * 0.22;
  const set = (x, y, [red, g, b], a = 255) => {
    const i = (y * size + x) * 4;
    px[i] = red;
    px[i + 1] = g;
    px[i + 2] = b;
    px[i + 3] = a;
  };
  // 圆角矩形遮罩
  const inside = (x, y) => {
    const cx = x < r ? r : x > size - r ? size - r : x;
    const cy = y < r ? r : y > size - r ? size - r : y;
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r || (x >= r && x <= size - r) || (y >= r && y <= size - r);
  };

  const grassTop = Math.round(size * 0.3);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!inside(x, y)) continue;
      const n = ((x * 73856093) ^ (y * 19349663)) >>> 0;
      if (y < grassTop) {
        const v = n % 17;
        set(x, y, v === 0 ? [70, 150, 84] : v < 4 ? [96, 196, 112] : [86, 185, 104]);
      } else {
        const v = n % 23;
        set(x, y, v === 0 ? [110, 72, 48] : v < 5 ? [126, 84, 56] : [139, 92, 62]);
      }
    }
  }
  // 草皮与泥土之间的加深线
  for (let x = 0; x < size; x++) {
    for (const y of [grassTop - 2, grassTop - 1, grassTop]) {
      if (inside(x, y)) set(x, y, [62, 140, 78]);
    }
  }
  // 高光
  for (let y = Math.round(size * 0.1); y < Math.round(size * 0.14); y++) {
    for (let x = Math.round(size * 0.12); x < Math.round(size * 0.5); x++) {
      if (inside(x, y)) set(x, y, [120, 220, 138], 120);
    }
  }
  return px;
}

for (const size of [192, 512]) {
  const file = path.join(OUT, `icon-${size}.png`);
  fs.writeFileSync(file, encodePng(size, size, draw(size)));
  console.log('wrote', file);
}
