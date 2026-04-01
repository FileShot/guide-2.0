/**
 * gen-marketing.js — Generate polished marketing images for graysoft.dev
 *
 * Takes raw guIDE screenshots and produces:
 *   - 6 composite PNGs in ./output/
 *   - Each has a deep gradient background, rounded device frame, drop shadow
 *
 * Usage: node gen-marketing.js
 * Requires: sharp (npm install sharp in this dir or use the existing one)
 */

const sharp = require('C:/Users/brend/IDE/website/node_modules/sharp');
const path = require('path');
const fs = require('fs');

const IN = __dirname;
const OUT = path.join(__dirname, 'output');
fs.mkdirSync(OUT, { recursive: true });

// The 6 source screenshots
const SOURCES = [
  // [filename,  outputStem,          label,                    gradient]
  ['Screenshot 2026-04-01 062951.png', 'graysoft-screenshot-1', 'Code Editor · AI Chat · 82 Tools',          '#0d0d1a', '#1a0d2e'],
  ['Screenshot 2026-04-01 063311.png', 'graysoft-screenshot-2', 'AI Generates Files in Real-Time',           '#0d1a10', '#0a1a0d'],
  ['Screenshot 2026-04-01 063007.png', 'graysoft-screenshot-3', 'Multiple Themes · Local-First Privacy',     '#0d1215', '#0a1520'],
  ['Screenshot 2026-04-01 063018.png', 'graysoft-screenshot-4', 'Solarized · Zero Cloud Dependency',        '#1a1000', '#1a0d00'],
  ['Screenshot 2026-04-01 063030.png', 'graysoft-ide-chat',     'Welcome Screen · Quick Start Actions',      '#0d0d1a', '#120d1a'],
  ['Screenshot 2026-04-01 063042.png', 'graysoft-ide-tools',    'Catppuccin Mocha · Settings Panel',         '#1a0d10', '#1a0810'],
];

// Output canvas dimensions (same ratio as 1366×768 screen but padded)
const CANVAS_W = 1600;
const CANVAS_H = 960;
const PADDING  = 48;   // padding around screenshot
const RADIUS   = 16;   // corner radius for screenshot frame

async function buildGradientBg(w, h, color1, color2) {
  // Build a vertical gradient SVG background
  const svg = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="${color1}"/>
        <stop offset="100%" stop-color="${color2}"/>
      </linearGradient>
    </defs>
    <rect width="${w}" height="${h}" fill="url(#bg)"/>
    <!-- subtle noise-like dots for depth -->
    <ellipse cx="${w * 0.25}" cy="${h * 0.3}" rx="${w * 0.35}" ry="${h * 0.4}" fill="white" fill-opacity="0.025"/>
    <ellipse cx="${w * 0.8}"  cy="${h * 0.7}" rx="${w * 0.3}"  ry="${h * 0.35}" fill="white" fill-opacity="0.02"/>
  </svg>`;
  return Buffer.from(svg);
}

function buildShadow(w, h) {
  // Drop shadow behind the screenshot frame
  return Buffer.from(`<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
    <filter id="s"><feDropShadow dx="0" dy="8" stdDeviation="24" flood-color="#000" flood-opacity="0.6"/></filter>
    <rect x="0" y="0" width="${w}" height="${h}" rx="${RADIUS}" ry="${RADIUS}"
          fill="#111" filter="url(#s)" opacity="0.9"/>
  </svg>`);
}

function buildFrame(imgW, imgH) {
  // Thin window chrome bar above the screenshot
  const chromeH = 32;
  const totalH = imgH + chromeH;
  return {
    chromeH,
    svg: Buffer.from(`<svg width="${imgW}" height="${totalH}" xmlns="http://www.w3.org/2000/svg">
      <!-- window chrome bar -->
      <rect x="0" y="0" width="${imgW}" height="${chromeH}"
            rx="${RADIUS}" ry="${RADIUS}" fill="#1e1e2e"/>
      <!-- traffic lights -->
      <circle cx="16" cy="${chromeH / 2}" r="6" fill="#ff5f57"/>
      <circle cx="32" cy="${chromeH / 2}" r="6" fill="#ffbd2e"/>
      <circle cx="48" cy="${chromeH / 2}" r="6" fill="#28c840"/>
      <!-- title text -->
      <text x="${imgW / 2}" y="${chromeH / 2 + 4}" text-anchor="middle"
            font-family="system-ui,sans-serif" font-size="11" fill="#888">guIDE</text>
      <!-- frame bottom border radius mask -->
      <rect x="0" y="${chromeH}" width="${imgW}" height="${imgH}" fill="transparent"/>
    </svg>`)
  };
}

async function processOne(src, outStem, label, c1, c2) {
  const srcPath = path.join(IN, src);
  console.log(`Processing: ${src} → ${outStem}`);

  // 1. Load source and get dimensions
  const meta = await sharp(srcPath).metadata();
  const srcW = meta.width;
  const srcH = meta.height;

  // 2. Fit screenshot to canvas minus padding
  const maxW = CANVAS_W - PADDING * 2;
  const maxH = CANVAS_H - PADDING * 2 - 32 - 40; // minus chrome + label
  const scale = Math.min(maxW / srcW, maxH / srcH);
  const dstW  = Math.round(srcW * scale);
  const dstH  = Math.round(srcH * scale);

  // 3. Resize source
  const resizedBuf = await sharp(srcPath)
    .resize(dstW, dstH)
    .toBuffer();

  // 4. Round the screenshot corners
  const roundMask = Buffer.from(
    `<svg><rect x="0" y="0" width="${dstW}" height="${dstH}"
     rx="${RADIUS}" ry="${RADIUS}"/></svg>`
  );
  const roundedImg = await sharp(resizedBuf)
    .composite([{ input: roundMask, blend: 'dest-in' }])
    .png()
    .toBuffer();

  // 5. Build background
  const bgBuf = await sharp(await buildGradientBg(CANVAS_W, CANVAS_H, c1, c2))
    .png()
    .toBuffer();

  // 6. Build window chrome frame
  const { chromeH, svg: frameSvg } = buildFrame(dstW, dstH);
  const frameBuf = await sharp(frameSvg).png().toBuffer();

  // 7. Label SVG at bottom
  const labelY = CANVAS_H - 28;
  const labelSvg = Buffer.from(
    `<svg width="${CANVAS_W}" height="${CANVAS_H}" xmlns="http://www.w3.org/2000/svg">
      <text x="${CANVAS_W / 2}" y="${labelY}"
            text-anchor="middle"
            font-family="system-ui,-apple-system,sans-serif"
            font-size="14" font-weight="500" fill="rgba(255,255,255,0.5)"
            letter-spacing="0.5">${label}</text>
    </svg>`
  );

  // 8. Composite everything onto background
  const xPos = Math.round((CANVAS_W - dstW) / 2);
  const yPos = Math.round((CANVAS_H - (dstH + chromeH)) / 2) - 12;

  const output = await sharp(bgBuf)
    .composite([
      // window chrome
      { input: frameBuf,   left: xPos, top: yPos },
      // screenshot below chrome
      { input: roundedImg, left: xPos, top: yPos + chromeH },
      // label
      { input: await sharp(labelSvg).png().toBuffer(), left: 0, top: 0 },
    ])
    .png({ compressionLevel: 8 })
    .toBuffer();

  // Write to output dir
  const outPath = path.join(OUT, `${outStem}.png`);
  fs.writeFileSync(outPath, output);
  const size = (output.length / 1024).toFixed(0);
  console.log(`  → ${outPath} (${size} KB)`);
}

(async () => {
  for (const [src, stem, label, c1, c2] of SOURCES) {
    await processOne(src, stem, label, c1, c2);
  }
  console.log('\nDone. Check .github/media/output/');
})();
