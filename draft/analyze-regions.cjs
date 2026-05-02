const fs = require('fs');
const { PNG } = require('pngjs');
const pixelmatch = require('pixelmatch').default;

const draftPath = 'draft/visual-diff-results/draft-topbar.png';
const targetPath = 'draft/visual-diff-results/target-topbar.png';

const draft = PNG.sync.read(fs.readFileSync(draftPath));
const target = PNG.sync.read(fs.readFileSync(targetPath));

const width = Math.min(draft.width, target.width);
const height = Math.min(draft.height, target.height);

const diff = new PNG({ width, height });
const diffPixels = pixelmatch(
  draft.data,
  target.data,
  diff.data,
  width,
  height,
  { threshold: 0.1, includeAA: true }
);

// Define regions based on topbar grid: rows ~162px, ~798px, ~120px
const regions = [
  { name: 'Top bar (y:0-162)', y1: 0, y2: 162 },
  { name: 'Main content (y:162-960)', y1: 162, y2: 960 },
  { name: 'Bottom bar (y:960-1080)', y1: 960, y2: 1080 },
  { name: 'Left margin (x:0-192, full)', y1: 0, y2: height, x1: 0, x2: 192 },
  { name: 'Right margin (x:1728-1920, full)', y1: 0, y2: height, x1: 1728, x2: width },
];

for (const r of regions) {
  const x1 = r.x1 || 0;
  const x2 = r.x2 || width;
  const y1 = r.y1;
  const y2 = r.y2;
  let regionDiff = 0;
  let regionTotal = 0;
  for (let y = y1; y < y2; y++) {
    for (let x = x1; x < x2; x++) {
      const idx = (y * width + x) * 4;
      if (diff.data[idx] > 0) regionDiff++;
      regionTotal++;
    }
  }
  console.log(`${r.name}: ${regionDiff}/${regionTotal} = ${(regionDiff/regionTotal*100).toFixed(2)}%`);
}

console.log(`\nTotal: ${diffPixels}/${width*height} = ${(diffPixels/(width*height)*100).toFixed(2)}%`);
