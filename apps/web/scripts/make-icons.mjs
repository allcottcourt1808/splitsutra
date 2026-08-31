/**
 * Generates the PWA icon set into `apps/web/public/`.
 *
 * ## Why this exists rather than four checked-in binaries
 *
 * The icons are derived from two token values (`primary`, `onPrimary`) and one shape. Checking
 * in PNGs would fork that: a brand colour change in `tokens.ts` would silently leave the home
 * screen on the old one, and nothing would fail. Regenerating is one command, and the source of
 * truth stays where Article IX says it is.
 *
 * ## Why a hand-rolled PNG encoder
 *
 * 🔴 Deliberate, not ignorance of `sharp`. Adding a native image dependency to a workspace that
 *    needs it exactly once — at build-asset time, never at runtime — costs every contributor a
 *    platform-specific binary download and a rebuild on every Node bump. `zlib` is in the
 *    standard library and a PNG is a header, one deflated block and a CRC. The whole encoder is
 *    forty lines and has no failure mode that is not immediately visible in the output.
 *
 * Run: `node apps/web/scripts/make-icons.mjs` (also wired as `pnpm --filter @splitsutra/web icons`).
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/* ── tokens ──────────────────────────────────────────────────────────────────────────────── */

/** Mirrors `packages/core/src/theme/tokens.ts`. Update both, or regenerate and commit. */
const PRIMARY = [0x1c, 0xc2, 0x9f];
/** `onPrimary` — the contrast-checked foreground for anything painted on a `primary` fill. */
const ON_PRIMARY = [0x04, 0x24, 0x1d];

/* ── PNG encoding ────────────────────────────────────────────────────────────────────────── */

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** `rgba` is a flat Uint8Array of size * size * 4. */
function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  // 10-12 are compression, filter and interlace methods — 0 is the only defined value for each.

  // Each scanline is prefixed with its filter byte. Filter 0 (None) throughout: these images are
  // small and flat, so the compression a smarter filter would buy is not worth the arithmetic.
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ── the mark ────────────────────────────────────────────────────────────────────────────── */

/**
 * A disc cut in two by a diagonal band — a thing being divided, which is the whole product.
 *
 * Full-bleed background rather than a rounded square: both iOS and Android mask the icon to
 * their own platform shape, and a rounded square inside a rounded square reads as a sticker.
 *
 * `markRadius` is a fraction of the canvas. The maskable variant uses a smaller one because
 * Android may crop to a circle of 80% diameter, so anything outside a 40% radius is not
 * guaranteed to survive.
 */
function render(size, markRadius) {
  const rgba = new Uint8Array(size * size * 4);
  const c = size / 2;
  const r = size * markRadius;
  const gap = size * 0.055; // half-width of the dividing band
  const SS = 4; // supersampling factor per axis — this is the only antialiasing

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let hits = 0;
      for (let sy = 0; sy < SS; sy += 1) {
        for (let sx = 0; sx < SS; sx += 1) {
          const px = x + (sx + 0.5) / SS - c;
          const py = y + (sy + 0.5) / SS - c;
          if (px * px + py * py > r * r) continue;
          // Signed distance to a line through the centre at 60°, so the split reads as a
          // deliberate diagonal rather than a half that could be a lighting effect.
          const d = px * Math.sin(Math.PI / 3) - py * Math.cos(Math.PI / 3);
          if (Math.abs(d) > gap) hits += 1;
        }
      }
      const alpha = hits / (SS * SS);
      const i = (y * size + x) * 4;
      for (let ch = 0; ch < 3; ch += 1) {
        rgba[i + ch] = Math.round(PRIMARY[ch] * (1 - alpha) + ON_PRIMARY[ch] * alpha);
      }
      rgba[i + 3] = 255;
    }
  }
  return rgba;
}

/* ── output ──────────────────────────────────────────────────────────────────────────────── */

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
mkdirSync(outDir, { recursive: true });

const targets = [
  ['icon-192.png', 192, 0.32],
  ['icon-512.png', 512, 0.32],
  // Smaller mark: Android crops a maskable icon to 80% diameter. See `render`.
  ['icon-maskable-512.png', 512, 0.26],
  // iOS applies its own mask and never reads the manifest for this one.
  ['apple-touch-icon.png', 180, 0.32],
];

for (const [name, size, markRadius] of targets) {
  writeFileSync(join(outDir, name), encodePng(size, render(size, markRadius)));
  console.log(`wrote ${name} (${String(size)}px)`);
}

/* The favicon stays SVG: it is the one icon rendered at 16px, where a vector beats any raster,
   and browsers that cannot read it fall back to the apple-touch-icon above. */
const teal = `#${PRIMARY.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
const ink = `#${ON_PRIMARY.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
writeFileSync(
  join(outDir, 'favicon.svg'),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" fill="${teal}"/>
  <mask id="s">
    <circle cx="32" cy="32" r="20" fill="#fff"/>
    <path d="M32 0 L69 21 L32 64 L-5 43 Z" fill="#000" transform="rotate(30 32 32)" opacity="0"/>
  </mask>
  <circle cx="32" cy="32" r="20" fill="${ink}"/>
  <rect x="28.5" y="6" width="7" height="52" fill="${teal}" transform="rotate(30 32 32)"/>
</svg>
`,
);
console.log('wrote favicon.svg');
