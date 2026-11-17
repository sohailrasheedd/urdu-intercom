const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// 1. Create clean SVG source file
const svgSource = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <rect width="512" height="512" rx="104" fill="#0f172a"/>
  <!-- Intercom device base -->
  <rect x="116" y="76" width="280" height="360" rx="48" fill="#1e293b" stroke="#3b82f6" stroke-width="12"/>
  <!-- Status LED -->
  <circle cx="256" cy="126" r="14" fill="#22c55e"/>
  <!-- Speaker grille bars -->
  <rect x="166" y="170" width="180" height="14" rx="7" fill="#60a5fa"/>
  <rect x="166" y="202" width="180" height="14" rx="7" fill="#60a5fa"/>
  <rect x="166" y="234" width="180" height="14" rx="7" fill="#60a5fa"/>
  <rect x="166" y="266" width="180" height="14" rx="7" fill="#60a5fa"/>
  <!-- Call / PTT Button -->
  <rect x="186" y="320" width="140" height="56" rx="28" fill="#2563eb" stroke="#60a5fa" stroke-width="6"/>
  <!-- Audio wave arcs above button -->
  <path d="M236 348 A 20 20 0 0 1 276 348" fill="none" stroke="#ffffff" stroke-width="6" stroke-linecap="round"/>
</svg>`;

const assetsDir = path.join(__dirname, 'assets');
if(!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir, { recursive: true });
fs.writeFileSync(path.join(assetsDir, 'icon.svg'), svgSource, 'utf8');

// Helper to create valid PNG from RGBA buffer
function createPng(width, height, rgbaBuffer) {
  // Signature
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR chunk
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type 6: RGBA
  ihdr[10] = 0; // compression method
  ihdr[11] = 0; // filter method
  ihdr[12] = 0; // interlace method

  function makeChunk(type, data) {
    const len = data.length;
    const buf = Buffer.alloc(4 + 4 + len + 4);
    buf.writeUInt32BE(len, 0);
    buf.write(type, 4, 4, 'ascii');
    data.copy(buf, 8);
    const crc = crc32(buf.subarray(4, 8 + len));
    buf.writeInt32BE(crc, 8 + len);
    return buf;
  }

  // Scanlines with filter byte 0 (None)
  const scanlines = Buffer.alloc(height * (1 + width * 4));
  let scanlineOffset = 0;
  for (let y = 0; y < height; y++) {
    scanlines[scanlineOffset++] = 0; // filter None
    const rowOffset = y * width * 4;
    rgbaBuffer.copy(scanlines, scanlineOffset, rowOffset, rowOffset + width * 4);
    scanlineOffset += width * 4;
  }

  const compressedData = zlib.deflateSync(scanlines);
  const ihdrChunk = makeChunk('IHDR', ihdr);
  const idatChunk = makeChunk('IDAT', compressedData);
  const iendChunk = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

// CRC32 table & function
const crcTable = new Int32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    if (c & 1) c = 0xedb88320 ^ (c >>> 1);
    else c = c >>> 1;
  }
  crcTable[n] = c;
}
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) {
    c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return c ^ (-1);
}

// Rendering function to draw intercom icon
function renderIntercomIcon(size, isMaskable = false, isMonochromeBadge = false) {
  const buf = Buffer.alloc(size * size * 4);
  const scale = size / 512;

  function setPixel(x, y, r, g, b, a) {
    if (x < 0 || x >= size || y < 0 || y >= size) return;
    const idx = (y * size + x) * 4;
    if (a >= 255) {
      buf[idx] = r;
      buf[idx + 1] = g;
      buf[idx + 2] = b;
      buf[idx + 3] = 255;
    } else if (a > 0) {
      const alpha = a / 255;
      const bgA = buf[idx + 3] / 255;
      const outA = alpha + bgA * (1 - alpha);
      if (outA > 0) {
        buf[idx] = Math.round((r * alpha + buf[idx] * bgA * (1 - alpha)) / outA);
        buf[idx + 1] = Math.round((g * alpha + buf[idx + 1] * bgA * (1 - alpha)) / outA);
        buf[idx + 2] = Math.round((b * alpha + buf[idx + 2] * bgA * (1 - alpha)) / outA);
        buf[idx + 3] = Math.round(outA * 255);
      }
    }
  }

  function fillRoundRect(rx1, ry1, rw, rh, rad, r, g, b, a) {
    for (let py = Math.floor(ry1); py < Math.ceil(ry1 + rh); py++) {
      for (let px = Math.floor(rx1); px < Math.ceil(rx1 + rw); px++) {
        // check corner distance
        let inShape = true;
        let dx = 0, dy = 0;
        if (px < rx1 + rad) dx = rx1 + rad - px;
        else if (px > rx1 + rw - rad) dx = px - (rx1 + rw - rad);
        if (py < ry1 + rad) dy = ry1 + rad - py;
        else if (py > ry1 + rh - rad) dy = py - (ry1 + rh - rad);

        if (dx > 0 && dy > 0) {
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist > rad) inShape = false;
        }
        if (inShape) {
          setPixel(px, py, r, g, b, a);
        }
      }
    }
  }

  function fillCircle(cx, cy, radius, r, g, b, a) {
    for (let py = Math.floor(cy - radius); py <= Math.ceil(cy + radius); py++) {
      for (let px = Math.floor(cx - radius); px <= Math.ceil(cx + radius); px++) {
        const d = Math.hypot(px - cx, py - cy);
        if (d <= radius) {
          setPixel(px, py, r, g, b, a);
        }
      }
    }
  }

  if (isMonochromeBadge) {
    // Monochrome badge: transparent background, white shapes
    // Simplified intercom glyph for 96x96 badge
    fillRoundRect(size * 0.2, size * 0.15, size * 0.6, size * 0.7, size * 0.1, 255, 255, 255, 255);
    // Darker inside cutout / holes
    fillRoundRect(size * 0.28, size * 0.32, size * 0.44, size * 0.06, size * 0.03, 0, 0, 0, 0);
    fillRoundRect(size * 0.28, size * 0.44, size * 0.44, size * 0.06, size * 0.03, 0, 0, 0, 0);
    fillRoundRect(size * 0.28, size * 0.56, size * 0.44, size * 0.06, size * 0.03, 0, 0, 0, 0);
    fillCircle(size * 0.5, size * 0.72, size * 0.07, 0, 0, 0, 0);
    return buf;
  }

  // Normal / Maskable PWA Icon:
  // Background: #0f172a (15, 23, 42)
  if (isMaskable) {
    // Full bleed background
    fillRoundRect(0, 0, size, size, 0, 15, 23, 42, 255);
  } else {
    // Rounded rect icon background (squircle)
    fillRoundRect(0, 0, size, size, size * 0.2, 15, 23, 42, 255);
  }

  // Intercom body: #1e293b with blue border #3b82f6
  const s = isMaskable ? scale * 0.82 : scale; // Safe area padding for maskable
  const cx = size / 2;
  const cy = size / 2;
  const bodyW = 280 * s;
  const bodyH = 360 * s;
  const bodyX = cx - bodyW / 2;
  const bodyY = cy - bodyH / 2;

  // Blue outer border
  fillRoundRect(bodyX - 6 * s, bodyY - 6 * s, bodyW + 12 * s, bodyH + 12 * s, 48 * s, 59, 130, 246, 255);
  // Inner body
  fillRoundRect(bodyX, bodyY, bodyW, bodyH, 44 * s, 30, 41, 59, 255);

  // Status LED: #22c55e (green)
  fillCircle(cx, bodyY + 50 * s, 14 * s, 34, 197, 94, 255);

  // Speaker grille bars: #60a5fa
  const barW = 180 * s;
  const barH = 14 * s;
  const barX = cx - barW / 2;
  for (let i = 0; i < 4; i++) {
    fillRoundRect(barX, bodyY + (94 + i * 32) * s, barW, barH, 7 * s, 96, 165, 250, 255);
  }

  // Call Button: #2563eb with border #60a5fa
  const btnW = 140 * s;
  const btnH = 56 * s;
  const btnX = cx - btnW / 2;
  const btnY = bodyY + 244 * s;
  fillRoundRect(btnX - 3 * s, btnY - 3 * s, btnW + 6 * s, btnH + 6 * s, 31 * s, 96, 165, 250, 255);
  fillRoundRect(btnX, btnY, btnW, btnH, 28 * s, 37, 99, 235, 255);

  // Small white accent on button
  fillRoundRect(cx - 24 * s, btnY + 24 * s, 48 * s, 8 * s, 4 * s, 255, 255, 255, 255);

  return buf;
}

// Generate all required PNG files
const icons = [
  { file: 'icon-192.png', size: 192, maskable: false, badge: false },
  { file: 'icon-512.png', size: 512, maskable: false, badge: false },
  { file: 'icon-maskable-512.png', size: 512, maskable: true, badge: false },
  { file: 'apple-touch-icon.png', size: 180, maskable: false, badge: false },
  { file: 'badge-96.png', size: 96, maskable: false, badge: true }
];

icons.forEach(({ file, size, maskable, badge }) => {
  const buf = renderIntercomIcon(size, maskable, badge);
  const png = createPng(size, size, buf);
  fs.writeFileSync(path.join(assetsDir, file), png);
  console.log('Generated:', file, `(${size}x${size})`);
});
