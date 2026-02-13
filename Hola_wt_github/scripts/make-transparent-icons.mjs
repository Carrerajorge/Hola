import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';

function processPngBuffer(buf, { whiteCutoff = 245, fadeStart = 220 } = {}) {
  const png = PNG.sync.read(buf);

  for (let y = 0; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) {
      const idx = (png.width * y + x) << 2;
      const r = png.data[idx];
      const g = png.data[idx + 1];
      const b = png.data[idx + 2];
      const a = png.data[idx + 3];

      // Only operate on already-opaque/visible pixels.
      if (a === 0) continue;

      const whiteness = Math.min(r, g, b);
      if (whiteness >= whiteCutoff) {
        png.data[idx + 3] = 0;
        continue;
      }
      if (whiteness > fadeStart) {
        const t = (whiteCutoff - whiteness) / (whiteCutoff - fadeStart); // 0..1
        const newA = Math.max(0, Math.min(255, Math.round(a * t)));
        png.data[idx + 3] = newA;
      }
    }
  }

  return PNG.sync.write(png);
}

function processFile(relPath) {
  const abs = path.resolve(relPath);
  const before = fs.readFileSync(abs);
  const after = processPngBuffer(before);
  fs.writeFileSync(abs, after);
  console.log(`✅ wrote transparent background: ${relPath}`);
}

const targets = [
  'client/public/favicon.png',
  'client/src/assets/sira-logo.png',
  // optional PWA icon used in some surfaces
  'client/public/pwa-192x192.png',
];

for (const t of targets) {
  if (!fs.existsSync(t)) {
    console.warn(`⚠️ missing: ${t}`);
    continue;
  }
  try {
    processFile(t);
  } catch (err) {
    console.warn(`⚠️ failed to process ${t}: ${err?.message || err}`);
  }
}
