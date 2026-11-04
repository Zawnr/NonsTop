// Generates the PWA icons (no image tools needed): a white "N" on a dark rounded tile.
// Run: node scripts/make-icons.mjs
import fs from 'node:fs';
import zlib from 'node:zlib';

const BG = [24, 24, 27];
const FG = [250, 250, 250];

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (const b of buf) {
    c = (crc ^ b) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/** maskable: full-bleed background, glyph inside the 80% safe zone. */
function icon(size, { maskable }) {
  const px = Buffer.alloc(size * (size * 4 + 1));
  const radius = maskable ? 0 : size * 0.22;
  const scale = maskable ? 0.42 : 0.56; // glyph box as a fraction of the icon
  const g0 = (size * (1 - scale)) / 2;
  const g1 = g0 + size * scale;
  const bar = size * scale * 0.2;
  const inRounded = (x, y) => {
    const cx = Math.min(Math.max(x, radius), size - radius);
    const cy = Math.min(Math.max(y, radius), size - radius);
    return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2;
  };
  const inN = (x, y) => {
    if (y < g0 || y > g1 || x < g0 || x > g1) return false;
    if (x <= g0 + bar || x >= g1 - bar) return true;
    // diagonal from top-left to bottom-right
    const t = (y - g0) / (g1 - g0);
    const dx = g0 + bar / 2 + t * (g1 - g0 - bar);
    return Math.abs(x - dx) <= bar * 0.6;
  };
  for (let y = 0; y < size; y++) {
    const row = y * (size * 4 + 1);
    px[row] = 0;
    for (let x = 0; x < size; x++) {
      // 4x supersampling for smooth edges
      let fg = 0, bg = 0;
      for (const [ox, oy] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]) {
        const sx = x + ox, sy = y + oy;
        if (!inRounded(sx, sy)) continue;
        if (inN(sx, sy)) fg++; else bg++;
      }
      const a = (fg + bg) / 4;
      const i = row + 1 + x * 4;
      for (let c = 0; c < 3; c++) px[i + c] = fg + bg ? Math.round((FG[c] * fg + BG[c] * bg) / (fg + bg)) : 0;
      px[i + 3] = Math.round(a * 255);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(px)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const out = new URL('../public/icons/', import.meta.url);
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(new URL('icon-192.png', out), icon(192, { maskable: false }));
fs.writeFileSync(new URL('icon-512.png', out), icon(512, { maskable: false }));
fs.writeFileSync(new URL('maskable-512.png', out), icon(512, { maskable: true }));
fs.writeFileSync(new URL('apple-touch-icon.png', out), icon(180, { maskable: true }));
console.log('icons written');
