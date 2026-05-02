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

// Count RED diff pixels by region
const regions = [
  { name: 'header', y0: 0, y1: 178 },
  { name: 'sidebar', x1: 384, y0: 0, y1: 1080 },
  { name: 'row1-cards', x0: 384, y0: 178, y1: 574 },
  { name: 'row2-cards', x0: 384, y0: 574, y1: 976 },
  { name: 'bottom', x0: 384, y0: 976, y1: 1080 },
];

for (const r of regions) {
  let count = 0;
  let total = 0;
  const x0 = r.x0 || 0;
  const x1 = r.x1 || width;
  for (let y = r.y0; y < Math.min(r.y1, height); y++) {
    for (let x = x0; x < Math.min(x1, width); x++) {
      const idx = (y * width + x) * 4;
      total++;
      if (diff.data[idx] === 255 && diff.data[idx+1] === 0 && diff.data[idx+2] === 0) {
        count++;
      }
    }
  }
  console.log(`${r.name}: ${count.toLocaleString()} / ${total.toLocaleString()} = ${(count/total*100).toFixed(2)}%`);
}
