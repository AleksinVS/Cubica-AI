const fs = require('fs');
const { PNG } = require('pngjs');
const pixelmatch = require('pixelmatch').default;

const draft = PNG.sync.read(fs.readFileSync('draft/visual-diff-results/draft-topbar.png'));
const target = PNG.sync.read(fs.readFileSync('draft/visual-diff-results/target-topbar.png'));

const width = draft.width;
const height = draft.height;

const diff = new PNG({ width, height });
diff.data.fill(0);

pixelmatch(draft.data, target.data, diff.data, width, height, { threshold: 0.1, includeAA: true });

// Count diffs by horizontal band
const bandSize = 50;
for (let y = 0; y < height; y += bandSize) {
  let count = 0;
  for (let yy = y; yy < Math.min(y + bandSize, height); yy++) {
    for (let x = 0; x < width; x++) {
      const idx = (yy * width + x) * 4;
      if (diff.data[idx] > 0) count++;
    }
  }
  const pct = (count / (width * bandSize) * 100).toFixed(1);
  console.log(`y=${y}-${y+bandSize}: ${count} diff pixels (${pct}%)`);
}

// Also count diffs in specific x ranges for card bands
const cardRows = [
  { name: 'row1-cards', y: [178, 546] },
  { name: 'row2-cards', y: [546, 944] },
  { name: 'header', y: [0, 178] },
  { name: 'bottom', y: [944, 1080] },
];

for (const r of cardRows) {
  let count = 0;
  let total = 0;
  for (let y = r.y[0]; y < Math.min(r.y[1], height); y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      total++;
      if (diff.data[idx] > 0) count++;
    }
  }
  const pct = (count / total * 100).toFixed(1);
  console.log(`${r.name}: ${count}/${total} = ${pct}%`);
}
