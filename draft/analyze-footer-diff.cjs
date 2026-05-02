const fs = require('fs');
const { PNG } = require('pngjs');
const pixelmatch = require('pixelmatch').default;

const draft = PNG.sync.read(fs.readFileSync('draft/visual-diff-results/draft-leftsidebar.png'));
const target = PNG.sync.read(fs.readFileSync('draft/visual-diff-results/target-leftsidebar.png'));

const width = Math.min(draft.width, target.width);
const height = Math.min(draft.height, target.height);

const diff = new PNG({ width, height });
diff.data.fill(0);

pixelmatch(draft.data, target.data, diff.data, width, height, { threshold: 0.1, includeAA: true });

// Analyze footer region y:976-1080, x:384-1920
const region = { x0: 384, x1: width, y0: 976, y1: 1080 };
let diffCount = 0;
let minX = width, maxX = 0, minY = height, maxY = 0;
for (let y = region.y0; y < Math.min(region.y1, height); y++) {
  for (let x = region.x0; x < Math.min(region.x1, width); x++) {
    const idx = (y * width + x) * 4;
    if (diff.data[idx] === 255 && diff.data[idx+1] === 0 && diff.data[idx+2] === 0) {
      diffCount++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
}
console.log(`Footer diff pixels: ${diffCount}`);
console.log(`Bounding box: x:${minX}-${maxX}, y:${minY}-${maxY}`);

// Also sample some pixels around the button areas to see what colors differ
const samplePoints = [
  { x: 455, y: 1004, name: 'draft-journal-left' },
  { x: 472, y: 1005, name: 'target-journal-left' },
  { x: 1636, y: 1006, name: 'draft-arrow-left' },
  { x: 1619, y: 1003, name: 'target-arrow-left' },
];
for (const p of samplePoints) {
  const idx = (p.y * width + p.x) * 4;
  const d = { r: draft.data[idx], g: draft.data[idx+1], b: draft.data[idx+2] };
  const t = { r: target.data[idx], g: target.data[idx+1], b: target.data[idx+2] };
  console.log(`${p.name}: draft(${d.r},${d.g},${d.b}) target(${t.r},${t.g},${t.b})`);
}
