/**
 * Generate minimal valid PNG icons for Tauri bundle.
 * Creates solid-color placeholder icons at required sizes.
 * These should be replaced with proper branding assets before release.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function createPng(width, height, r, g, b) {
  // Minimal valid PNG with a solid color fill
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  function chunk(type, data) {
    const buf = Buffer.alloc(4 + type.length + data.length + 4);
    buf.writeUInt32BE(data.length, 0);
    buf.write(type, 4);
    data.copy(buf, 4 + type.length);
    // CRC32
    const crcData = Buffer.concat([Buffer.from(type), data]);
    let crc = crc32(crcData);
    buf.writeInt32BE(crc, buf.length - 4);
    return buf;
  }

  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // color type: RGB
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  // IDAT - raw pixel data with filter byte per row
  const rowBytes = 1 + width * 3; // filter byte + RGB per pixel
  const rawData = Buffer.alloc(rowBytes * height);
  for (let y = 0; y < height; y++) {
    const offset = y * rowBytes;
    rawData[offset] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const px = offset + 1 + x * 3;
      // Create a simple gradient with the guIDE brand color (#007acc)
      const factor = 1 - (y / height) * 0.3;
      rawData[px] = Math.round(r * factor);
      rawData[px + 1] = Math.round(g * factor);
      rawData[px + 2] = Math.round(b * factor);
    }
  }
  const compressed = zlib.deflateSync(rawData);

  // IEND
  const iend = Buffer.alloc(0);

  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', iend),
  ]);
}

// CRC32 implementation
const crcTable = new Int32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  }
  crcTable[n] = c;
}
function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc = crcTable[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) | 0;
}

// Generate icons
const iconsDir = path.join(__dirname, 'icons');
fs.mkdirSync(iconsDir, { recursive: true });

const sizes = [
  { name: '32x32.png', w: 32, h: 32 },
  { name: '128x128.png', w: 128, h: 128 },
  { name: '128x128@2x.png', w: 256, h: 256 },
];

for (const { name, w, h } of sizes) {
  const png = createPng(w, h, 0, 122, 204); // #007acc - VS Code blue
  fs.writeFileSync(path.join(iconsDir, name), png);
  console.log(`Generated ${name} (${w}x${h})`);
}

// Generate ICO file (minimal valid ICO with 32x32 PNG)
const png32 = createPng(32, 32, 0, 122, 204);
const icoHeader = Buffer.alloc(6);
icoHeader.writeUInt16LE(0, 0);     // reserved
icoHeader.writeUInt16LE(1, 2);     // type: ICO
icoHeader.writeUInt16LE(1, 4);     // 1 image

const icoEntry = Buffer.alloc(16);
icoEntry[0] = 32;                  // width
icoEntry[1] = 32;                  // height
icoEntry[2] = 0;                   // colors
icoEntry[3] = 0;                   // reserved
icoEntry.writeUInt16LE(1, 4);      // color planes
icoEntry.writeUInt16LE(32, 6);     // bits per pixel
icoEntry.writeUInt32LE(png32.length, 8);  // size
icoEntry.writeUInt32LE(22, 12);    // offset (6 + 16 = 22)

const ico = Buffer.concat([icoHeader, icoEntry, png32]);
fs.writeFileSync(path.join(iconsDir, 'icon.ico'), ico);
console.log('Generated icon.ico');
console.log('Icon generation complete.');
