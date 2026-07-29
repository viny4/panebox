#!/usr/bin/env node
/**
 * Generates the app + tray icons as PNGs, with no image dependencies.
 *
 * Everything is rasterised from signed-distance functions and written through a
 * minimal PNG encoder, so the icons are reproducible from source and we never
 * commit opaque binaries we can't diff. Run with `npm run icons`.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// ---------------------------------------------------------------- PNG encoder

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** @param {{width:number,height:number,data:Uint8Array}} img RGBA, 8-bit */
function encodePng(img) {
  const { width, height, data } = img;
  const stride = width * 4;
  // One filter byte (0 = None) per scanline.
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(data.buffer, data.byteOffset + y * stride, stride).copy(
      raw,
      y * (stride + 1) + 1,
    );
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ------------------------------------------------------------------- raster

function canvas(size) {
  return { width: size, height: size, data: new Uint8Array(size * size * 4) };
}

/** Alpha-over compositing of a straight-alpha colour onto the buffer. */
function blend(img, x, y, [r, g, b], a) {
  if (a <= 0) return;
  const i = (y * img.width + x) * 4;
  const dst = img.data[i + 3] / 255;
  const out = a + dst * (1 - a);
  if (out <= 0) return;
  for (let c = 0; c < 3; c++) {
    const src = [r, g, b][c];
    img.data[i + c] = Math.round((src * a + img.data[i + c] * dst * (1 - a)) / out);
  }
  img.data[i + 3] = Math.round(out * 255);
}

/** Signed distance to a rounded rectangle centred at (cx, cy). Negative = inside. */
function sdRoundRect(px, py, cx, cy, halfW, halfH, radius) {
  const qx = Math.abs(px - cx) - (halfW - radius);
  const qy = Math.abs(py - cy) - (halfH - radius);
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  return outside + Math.min(Math.max(qx, qy), 0) - radius;
}

/** Coverage in [0,1] for a distance field, antialiased over ~1px. */
function coverage(dist, feather) {
  return Math.min(Math.max(0.5 - dist / feather, 0), 1);
}

// -------------------------------------------------------------------- icons

/**
 * Menu-bar icon: two outlined panes, offset.
 *
 * macOS template images must be pure black + alpha; the OS recolours them, so
 * the orange never appears here. Three panes turn to mud at 22px, so the mark
 * reduces to two.
 */
function trayIcon(size, color) {
  const img = canvas(size);
  const cx = size / 2;
  const cy = size / 2;
  const w = size * 0.52;
  const h = size * 0.44;
  const r = size * 0.09;
  const stroke = Math.max(size * 0.072, 1.3);
  const feather = Math.max(size / 22, 0.75);
  const off = size * 0.1;

  // Back pane first, then a gap punched around the front one, then the front.
  const panes = [
    { dx: -off, dy: -off },
    { dx: off * 0.55, dy: off * 0.55 },
  ];

  for (let i = 0; i < panes.length; i++) {
    const { dx, dy } = panes[i];
    if (i > 0) {
      // Clear a margin so the outlines don't touch.
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const d = sdRoundRect(x + 0.5, y + 0.5, cx + dx, cy + dy, w / 2 + stroke, h / 2 + stroke, r + stroke);
          const a = coverage(d, feather);
          if (a > 0) {
            const idx = (y * size + x) * 4;
            img.data[idx + 3] = Math.round(img.data[idx + 3] * (1 - a));
          }
        }
      }
    }
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const d = Math.abs(sdRoundRect(x + 0.5, y + 0.5, cx + dx, cy + dy, w / 2, h / 2, r)) - stroke / 2;
        const a = coverage(d, feather);
        if (a > 0) blend(img, x, y, color, a);
      }
    }
  }

  return img;
}

/** Warm orange ramp, sampled diagonally across the plate. */
const PLATE_FROM = [0xff, 0xa4, 0x2e];
const PLATE_TO = [0xef, 0x47, 0x0a];

function plateColor(x, y, size) {
  const t = Math.min(Math.max((x / size) * 0.45 + (y / size) * 0.55, 0), 1);
  return [
    Math.round(PLATE_FROM[0] + (PLATE_TO[0] - PLATE_FROM[0]) * t),
    Math.round(PLATE_FROM[1] + (PLATE_TO[1] - PLATE_FROM[1]) * t),
    Math.round(PLATE_FROM[2] + (PLATE_TO[2] - PLATE_FROM[2]) * t),
  ];
}

/**
 * The app icon: three panes stacked in a box.
 *
 * Rather than a single window with a sidebar (which every container app draws),
 * this is the literal name — separate panes, offset and layered, held in one
 * container. Depth comes from opacity: the panes behind are more translucent,
 * so the orange shows through and the overlaps read as stacked glass.
 *
 * Each pane is cut out of the one behind it with a thin gap painted back to the
 * plate colour, so the layers stay legible at Dock size instead of merging into
 * one white blob.
 */
function appIcon(size) {
  const img = canvas(size);
  const pad = size * 0.09;
  const plateHalf = size / 2 - pad;
  const plateRadius = size * 0.225; // macOS "squircle"-ish
  const feather = Math.max(size / 256, 0.6);
  const cx = size / 2;
  const cy = size / 2;

  // 1. Gradient plate.
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const a = coverage(
        sdRoundRect(x + 0.5, y + 0.5, cx, cy, plateHalf, plateHalf, plateRadius),
        feather,
      );
      if (a > 0) blend(img, x, y, plateColor(x, y, size), a);
    }
  }

  // 2. Three panes, back to front.
  const paneW = size * 0.40;
  const paneH = size * 0.325;
  const paneR = size * 0.05;
  const stepX = size * 0.072;
  const stepY = size * 0.058;
  const gap = size * 0.019;

  const panes = [
    { dx: -stepX, dy: -stepY, alpha: 0.52 },
    { dx: 0, dy: 0, alpha: 0.76 },
    { dx: stepX, dy: stepY, alpha: 1 },
  ];

  for (const pane of panes) {
    const px0 = cx + pane.dx;
    const py0 = cy + pane.dy;

    // Cut a gap out of whatever is already there, so panes never merge.
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const a = coverage(
          sdRoundRect(x + 0.5, y + 0.5, px0, py0, paneW / 2 + gap, paneH / 2 + gap, paneR + gap),
          feather,
        );
        if (a > 0) blend(img, x, y, plateColor(x, y, size), a);
      }
    }

    // Then the pane itself.
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const a = coverage(
          sdRoundRect(x + 0.5, y + 0.5, px0, py0, paneW / 2, paneH / 2, paneR),
          feather,
        );
        if (a > 0) blend(img, x, y, [255, 255, 255], a * pane.alpha);
      }
    }
  }

  return img;
}

// ------------------------------------------------------------- PNG decoder

/**
 * Reads back the raw RGBA pixels of a PNG we wrote.
 *
 * Used only by --check. We compare *pixels*, not file bytes, because
 * deflate output varies with the zlib version bundled in each Node release —
 * a byte comparison would fail spuriously between a developer's machine and CI.
 */
function decodePng(buffer) {
  let offset = 8; // skip signature
  const idat = [];
  let width = 0;
  let height = 0;

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);

    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset += length + 12; // length + type + data + crc
  }

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const pixels = Buffer.alloc(stride * height);
  // We always write filter type 0, so unfiltering is just dropping that byte.
  for (let y = 0; y < height; y++) {
    raw.copy(pixels, y * stride, y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
  }
  return { width, height, data: pixels };
}

// --------------------------------------------------------------------- main

const assets = path.join(__dirname, '..', 'assets');
const checkOnly = process.argv.includes('--check');

const outputs = [
  // Template (black) for the macOS menu bar — @1x and @2x.
  ['trayTemplate.png', trayIcon(22, [0, 0, 0])],
  ['trayTemplate@2x.png', trayIcon(44, [0, 0, 0])],
  // White variant for Windows/Linux trays, which are usually dark.
  ['tray-light.png', trayIcon(32, [255, 255, 255])],
  ['icon.png', appIcon(1024)],
  ['icon-256.png', appIcon(256)],
];

if (checkOnly) {
  let failures = 0;
  for (const [name, expected] of outputs) {
    const file = path.join(assets, name);
    if (!fs.existsSync(file)) {
      console.error(`MISSING  ${name} — run "npm run icons"`);
      failures++;
      continue;
    }
    const actual = decodePng(fs.readFileSync(file));
    const sameSize = actual.width === expected.width && actual.height === expected.height;
    const samePixels = sameSize && Buffer.from(expected.data).equals(actual.data);
    if (samePixels) {
      console.log(`ok       ${name} (${expected.width}x${expected.height})`);
    } else {
      console.error(`DRIFTED  ${name} — committed asset does not match tools/make-icons.js`);
      failures++;
    }
  }
  if (failures) {
    console.error(`\n${failures} icon(s) out of date. Run "npm run icons" and commit the result.`);
    process.exit(1);
  }
  console.log('\nAll icons match their source.');
} else {
  fs.mkdirSync(assets, { recursive: true });
  for (const [name, img] of outputs) {
    const file = path.join(assets, name);
    fs.writeFileSync(file, encodePng(img));
    console.log(`wrote ${path.relative(process.cwd(), file)} (${img.width}x${img.height})`);
  }
}
