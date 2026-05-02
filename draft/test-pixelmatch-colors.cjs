const fs = require('fs');
const { PNG } = require('pngjs');
const pixelmatch = require('pixelmatch').default;

const draft = PNG.sync.read(fs.readFileSync('draft/visual-diff-results/draft-topbar.png'));
const target = PNG.sync.read(fs.readFileSync('draft/visual-diff-results/target-topbar.png'));

const width = Math.min(draft.width, target.width);
const height = Math.min(draft.height, target.height);

const diff = new PNG({ width, height });
diff.data.fill(0);

pixelmatch(draft.data, target.data, diff.data, width, height, { threshold: 0.1, includeAA: true });

// Sample some pixels
const samples = [
  { x: 100, y: 100 },
  { x: 500, y: 500 },
  { x: 1000, y: 800 },
];

for (const s of samples) {
  const idx = (s.y * width + s.x) * 4;
  console.log(`(${s.x},${s.y}): RGBA = [${diff.data[idx]}, ${diff.data[idx+1]}, ${diff.data[idx+2]}, ${diff.data[idx+3]}]`);
}

// Count pixels by color
let red = 0, other = 0;
for (let i = 0; i < diff.data.length; i += 4) {
  if (diff.data[i] === 255 && diff.data[i+1] === 0 && diff.data[i+2] === 0) red++;
  else if (diff.data[i] > 0 || diff.data[i+1] > 0 || diff.data[i+2] > 0) other++;
}
console.log('Red pixels:', red);
console.log('Other non-zero pixels:', other);
console.log('Total non-zero:', red + other);
