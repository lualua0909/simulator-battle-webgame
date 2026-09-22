// Vẽ icon game (2 thanh kiếm chéo trên nền vàng, viền mực) rồi xuất PNG/ICO.
// Zero-dependency: encoder PNG thuần (zlib của Node). Chạy 1 lần, commit file tĩnh.
//   node scripts/make-icons.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_ICONS = join(ROOT, 'public', 'icons');

const INK = [45, 50, 50, 255]; // #2d3232
const GOLD = [242, 184, 58, 255]; // #f2b83a
const GOLD_DARK = [217, 148, 32, 255];
const STEEL = [201, 206, 214, 255]; // #c9ced6
const WOOD = [138, 90, 43, 255]; // #8a5a2b

const distToSeg = (px, py, ax, ay, bx, by) => {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy || 1;
  const t = Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
};

// Vẽ 1 pixel (tọa độ 0..1) — khớp thiết kế src/app/icon.svg.
function paint(u, v, square, art) {
  // u,v: 0..1. art: tỉ lệ vùng vẽ (0.8 = chừa viền an toàn cho maskable).
  const cx = 0.5 + (u - 0.5) * art;
  const cy = 0.5 + (v - 0.5) * art;
  const R = 0.21875; // bo góc 14/64
  const B = 0.0625; // viền 4/64

  // Nền vàng (rounded-rect, hoặc full-bleed cho apple/maskable).
  let bg = 0;
  if (square) {
    bg = 1;
  } else {
    const qx = Math.abs(cx - 0.5) - (0.5 - R);
    const qy = Math.abs(cy - 0.5) - (0.5 - R);
    const d = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0);
    bg = d < R ? 1 : 0;
  }
  if (!bg) return [0, 0, 0, 0];

  // Viền mực (chỉ bản rounded; bản square để OS tự mask).
  if (!square) {
    const e = Math.min(cx, cy, 1 - cx, 1 - cy);
    if (e < B) return INK;
  }

  // Bóng đổ nhẹ nửa dưới cho có chiều sâu (chuyển mượt, không gắt).
  const shadeT = Math.min(1, Math.max(0, (cy - 0.45) / 0.55));
  const shadeF = shadeT * shadeT * 0.45;
  const base = [
    Math.round(GOLD[0] + (GOLD_DARK[0] - GOLD[0]) * shadeF),
    Math.round(GOLD[1] + (GOLD_DARK[1] - GOLD[1]) * shadeF),
    Math.round(GOLD[2] + (GOLD_DARK[2] - GOLD[2]) * shadeF),
    255,
  ];

  // Kiếm 1 (thép, /): (14,50)->(40,14) & (46,20)->(20,54)  => tâm (17,52)->(43,17), rộng ~7/64.
  const s1 = distToSeg(cx * 64, cy * 64, 17, 52, 43, 17);
  // Kiếm 2 (gỗ, \): tâm (47,52)->(21,17).
  const s2 = distToSeg(cx * 64, cy * 64, 47, 52, 21, 17);
  const W_BLADE = 3.6;
  const W_LINE = 5.2;

  let col = base;
  if (s1 < W_LINE || s2 < W_LINE) col = INK;
  if (s1 < W_BLADE) col = STEEL;
  if (s2 < W_BLADE) col = WOOD;
  // Highlight giữa lưỡi thép.
  if (s1 < 1.2) col = [232, 236, 242, 255];
  return col;
}

function render(size, { square = false, art = 1, ss = 4 } = {}) {
  const W = size * ss;
  const buf = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const [pr, pg, pb, pa] = paint((x + (sx + 0.5) / ss) / size, (y + (sy + 0.5) / ss) / size, square, art);
          r += pr;
          g += pg;
          b += pb;
          a += pa;
        }
      }
      const n = ss * ss;
      const o = (y * size + x) * 4;
      buf[o] = Math.round(r / n);
      buf[o + 1] = Math.round(g / n);
      buf[o + 2] = Math.round(b / n);
      buf[o + 3] = Math.round(a / n);
    }
  }
  return buf;
}

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
const crc = (buf) => {
  let c = -1;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const cs = Buffer.alloc(4);
  cs.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, cs]);
};
const encodePng = (rgba, size) => {
  const raw = Buffer.alloc(size * (1 + size * 4));
  for (let y = 0; y < size; y++) {
    raw[y * (1 + size * 4)] = 0; // filter None
    rgba.copy(raw, y * (1 + size * 4) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
};
// ICO chứa 1 frame PNG 32x32 (hợp lệ, trình duyệt hiện đại đọc được).
const encodeIco = (png32) => {
  const head = Buffer.alloc(6);
  head.writeUInt16LE(0, 0);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(1, 4);
  const dir = Buffer.alloc(16);
  dir[0] = 32;
  dir[1] = 32;
  dir[4] = 1;
  dir.writeUInt16LE(32, 6);
  dir.writeUInt32LE(png32.length, 8);
  dir.writeUInt32LE(22, 12);
  return Buffer.concat([head, dir, png32]);
};

mkdirSync(OUT_ICONS, { recursive: true });
const png32 = encodePng(render(32), 32);
writeFileSync(join(ROOT, 'public', 'favicon.ico'), encodeIco(png32));
writeFileSync(join(OUT_ICONS, 'icon-16.png'), encodePng(render(16), 16));
writeFileSync(join(OUT_ICONS, 'icon-32.png'), png32);
writeFileSync(join(ROOT, 'public', 'apple-touch-icon.png'), encodePng(render(180, { square: true }), 180));
writeFileSync(join(OUT_ICONS, 'icon-192.png'), encodePng(render(192, { square: true, art: 0.8 }), 192));
writeFileSync(join(OUT_ICONS, 'icon-512.png'), encodePng(render(512, { square: true, art: 0.8 }), 512));
console.log('icons written: favicon.ico, icons/icon-16|32|192|512.png, apple-touch-icon.png');
