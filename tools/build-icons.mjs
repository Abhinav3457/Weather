#!/usr/bin/env node
/* ============================================================================
 * tools/build-icons.mjs — regenerate every app icon from one source of truth.
 *
 * The mark is described once as signed-distance shapes in a 64x64 grid and
 * rasterised with supersampling, so favicon.ico, the manifest PNGs, the
 * maskable variant and apple-touch-icon all match the SVG mark in index.html.
 * No dependencies, no ImageMagick, no network: the PNG bytes are written here.
 *
 *   node tools/build-icons.mjs
 * ========================================================================== */

import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/* ------------------------------- geometry ------------------------------- */

const clamp01 = (value) => (value < 0 ? 0 : value > 1 ? 1 : value);

const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

const sdCircle = (x, y, cx, cy, r) => Math.hypot(x - cx, y - cy) - r;

const sdRoundBox = (x, y, cx, cy, hw, hh, r) => {
  const dx = Math.abs(x - cx) - hw + r;
  const dy = Math.abs(y - cy) - hh + r;
  return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(0, Math.max(dx, dy)) - r;
};

const sdCapsule = (x, y, x1, y1, x2, y2, r) => {
  const vx = x2 - x1;
  const vy = y2 - y1;
  const wx = x - x1;
  const wy = y - y1;
  const t = clamp01((vx * wx + vy * wy) / (vx * vx + vy * vy || 1e-6));
  return Math.hypot(wx - vx * t, wy - vy * t) - r;
};

/** Two circles plus a rounded base, fused: the cloud. */
const sdCloud = (x, y) => Math.min(sdCircle(x, y, 21.5, 33, 9.5), sdCircle(x, y, 33, 29.5, 12), sdRoundBox(x, y, 27.5, 35.5, 17, 5.2, 4.6));

/* --------------------------------- art --------------------------------- */

const SKY_TOP = [56, 189, 248]; // #38bdf8 — light near the top of the tile
const SKY_BOTTOM = [7, 55, 86]; // #073756 — deepening towards the bottom

const COLORS = {
  sunCore: [253, 224, 71], // #fde047
  sun: [251, 191, 36], // #fbbf24
  glow: [253, 230, 138], // #fef3c2
  cloud: [248, 250, 252], // #f8fafc
  cloudShade: [203, 213, 225], // #cbd5e1
  drop: [125, 211, 252], // #7dd3fc
  shadow: [2, 20, 38],
};

const DROPS = [
  [21.5, 44.5, 19.5, 50.5],
  [31.5, 44.5, 29.5, 50.5],
  [41.5, 44.5, 39.5, 50.5],
];

/**
 * One sample of the mark.
 * @param {number} x @param {number} y view-space coordinates (0..64)
 * @param {{maskable?: boolean, soft?: number}} [options]
 * @returns {[number, number, number]} RGB plus A in 0..1
 */
function sample(x, y, options = {}) {
  const maskable = Boolean(options.maskable);
  const soft = options.soft ?? 0.8;

  // The tile: rounded for "any" icons, full-bleed for maskable / touch icons.
  const tileSd = maskable ? -1 : sdRoundBox(x, y, 32, 32, 32, 32, 14);
  const tile = maskable ? 1 : clamp01(0.5 - tileSd / soft);
  if (tile <= 0) return null;

  // Keep artwork inside the 80% safe zone of a masked shape; tiny sizes get a
  // tighter crop of the mark so the silhouette still reads at 16 px.
  const inset = options.fit ?? (maskable ? 0.78 : 1);
  const px = 32 + (x - 32) / inset;
  const py = 32 + (y - 32) / inset;

  const sky = mix(SKY_TOP, SKY_BOTTOM, clamp01(py / 64) ** 0.75);

  // "source over" compositing, unpremultiplied.
  let color = sky;
  let alpha = tile;
  const over = (rgb, coverage) => {
    if (!(coverage > 0)) return;
    const next = coverage + alpha * (1 - coverage);
    color = [
      (rgb[0] * coverage + color[0] * alpha * (1 - coverage)) / next,
      (rgb[1] * coverage + color[1] * alpha * (1 - coverage)) / next,
      (rgb[2] * coverage + color[2] * alpha * (1 - coverage)) / next,
    ];
    alpha = next;
  };

  const sun = Math.hypot(px - 44, py - 19.5);
  over(COLORS.glow, clamp01(1 - (sun - 8.6) / 6) * 0.22);
  over(COLORS.sun, clamp01(0.5 - (sun - 8.2) / soft) * 0.98);

  const cloud = sdCloud(px, py);
  over(COLORS.shadow, clamp01(0.5 - sdCloud(px, py + 2.6) / (soft * 1.6)) * 0.28);
  over(COLORS.cloud, clamp01(0.5 - cloud / soft));
  if (cloud < 0 && py > 36.5) over(COLORS.cloudShade, clamp01((py - 36.5) / 5) * 0.45);

  if (options.detail !== false) {
    for (const [x1, y1, x2, y2] of DROPS) {
      over(COLORS.drop, clamp01(0.5 - sdCapsule(px, py, x1, y1, x2, y2, 1.7) / soft) * 0.96);
    }
  }

  return [color[0], color[1], color[2], alpha];
}

/* ------------------------------- rasterise ------------------------------- */

function render(size, options = {}) {
  const samples = size >= 512 ? 3 : size >= 160 ? 4 : 5;
  const step = 64 / size;
  const data = Buffer.alloc(size * size * 4);
  const divisor = samples * samples;

  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      let preR = 0;
      let preG = 0;
      let preB = 0;
      let preA = 0;
      for (let sy = 0; sy < samples; sy += 1) {
        for (let sx = 0; sx < samples; sx += 1) {
          const value = sample((col + (sx + 0.5) / samples) * step, (row + (sy + 0.5) / samples) * step, {
            ...options,
            fit: options.fit ?? (size <= 24 ? 0.72 : 1),
            detail: options.detail ?? size > 24,
          });
          if (!value) continue;
          const a = value[3];
          preR += value[0] * a;
          preG += value[1] * a;
          preB += value[2] * a;
          preA += a;
        }
      }
      const alpha = preA / divisor;
      const offset = (row * size + col) * 4;
      if (alpha > 0.002) {
        // Average was taken on premultiplied values; divide back out.
        data[offset] = Math.min(255, Math.round((preR / divisor / alpha) * 1));
        data[offset + 1] = Math.min(255, Math.round((preG / divisor / alpha) * 1));
        data[offset + 2] = Math.min(255, Math.round((preB / divisor / alpha) * 1));
      }
      data[offset + 3] = Math.round(clamp01(alpha) * 255);
    }
  }
  return { data, size };
}

/* -------------------------------- encode -------------------------------- */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (let index = 0; index < buffer.length; index += 1) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buffer[index]) & 0xff];
  return (crc ^ -1) >>> 0;
}

function chunk(type, payload) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(payload.length, 0);
  const body = Buffer.concat([Buffer.from(type, "latin1"), payload]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

function encodePng({ data, size }) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // truecolour with alpha

  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let row = 0; row < size; row += 1) {
    raw[row * (stride + 1)] = 0; // filter type: none
    data.copy(raw, row * (stride + 1) + 1, row * stride, row * stride + stride);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** ICO entries may carry PNG payloads (Vista and later), which keeps this tiny. */
function encodeIco(entries) {
  const header = Buffer.alloc(6 + entries.length * 16);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(entries.length, 4);

  let offset = header.length;
  entries.forEach((entry, index) => {
    const dir = 6 + index * 16;
    header[dir] = entry.size >= 256 ? 0 : entry.size;
    header[dir + 1] = entry.size >= 256 ? 0 : entry.size;
    header.writeUInt16LE(1, dir + 4); // colour planes
    header.writeUInt16LE(32, dir + 6); // bits per pixel
    header.writeUInt32LE(entry.bytes.length, dir + 8);
    header.writeUInt32LE(offset, dir + 12);
    offset += entry.bytes.length;
  });

  return Buffer.concat([header, ...entries.map((entry) => entry.bytes)]);
}

/* --------------------------------- main --------------------------------- */

function write(name, buffer) {
  writeFileSync(join(ROOT, name), buffer);
  console.log(`wrote ${name.padEnd(22)} ${(buffer.length / 1024).toFixed(1).padStart(7)} kB`);
}

const started = Date.now();

const targets = [
  { file: "icon-512.png", size: 512 },
  { file: "icon-192.png", size: 192 },
  { file: "maskable-512.png", size: 512, options: { maskable: true } },
  { file: "apple-touch-icon.png", size: 180, options: { maskable: true } },
];

for (const target of targets) {
  write(target.file, encodePng(render(target.size, target.options ?? {})));
}

write(
  "favicon.ico",
  encodeIco(
    [16, 32, 48].map((size) => ({
      size,
      bytes: encodePng(render(size, { soft: size <= 24 ? 1.3 : 1.1, fit: size <= 24 ? 0.7 : 1, detail: size > 24 })),
    }))
  )
);

/* The SVG mark used by <link rel="icon"> — hand-written, kept in sync by hand. */
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="Atmosphere Desk">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#38bdf8" />
      <stop offset="0.55" stop-color="#0c7eb8" />
      <stop offset="1" stop-color="#073756" />
    </linearGradient>
  </defs>
  <rect width="64" height="64" rx="14" fill="url(#sky)" />
  <circle cx="44" cy="19.5" r="8.4" fill="#fbbf24" />
  <g fill="#f8fafc">
    <circle cx="21.5" cy="33" r="9.5" />
    <circle cx="33" cy="29.5" r="12" />
    <rect x="10.5" y="30.3" width="34" height="10.4" rx="5.2" />
  </g>
  <g stroke="#7dd3fc" stroke-width="3.4" stroke-linecap="round">
    <path d="M21.5 45l-2 6" />
    <path d="M31.5 45l-2 6" />
    <path d="M41.5 45l-2 6" />
  </g>
</svg>
`;
write("favicon.svg", Buffer.from(svg, "utf8"));

console.log(`\ndone in ${((Date.now() - started) / 1000).toFixed(1)} s — rerun after changing the mark.`);
