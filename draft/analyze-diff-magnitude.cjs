const fs = require('fs');
const { PNG } = require('pngjs');

const diffPath = 'draft/visual-diff-results/diff-topbar.png';
const diff = PNG.sync.read(fs.readFileSync(diffPath));
const width = diff.width;
const height = diff.height;

// Count pixels by diff magnitude (stored in red channel of diff PNG)
const bins = { low: 0, med: 0, high: 0 };
for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    const idx = (y * width + x) * 4;
    const r = diff.data[idx];
    if (r === 0) continue;
    if (r < 50) bins.low++;
    else if (r < 150) bins.med++;
    else bins.high++;
  }
}

console.log('Diff magnitude distribution (red channel):');
console.log(`  Low (1-49): ${bins.low.toLocaleString()}`);
console.log(`  Med (50-149): ${bins.med.toLocaleString()}`);
console.log(`  High (150+): ${bins.high.toLocaleString()}`);
console.log(`  Total non-zero: ${(bins.low + bins.med + bins.high).toLocaleString()}`);

// Sample specific coordinates in the right margin
const samples = [
  { x: 1800, y: 300 },
  { x: 1800, y: 500 },
  { x: 1800, y: 700 },
  { x: 100, y: 300 },
  { x: 100, y: 500 },
];

console.log('\nSample diff magnitudes:');
for (const p of samples) {
  const idx = (p.y * width + p.x) * 4;
  console.log(`  (${p.x},${p.y}): diff=${diff.data[idx]}`);
}
