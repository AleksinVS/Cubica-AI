const fs = require('fs');
const { PNG } = require('pngjs');
const pixelmatch = require('pixelmatch').default;

const draft = PNG.sync.read(fs.readFileSync('draft/visual-diff-results/draft-leftsidebar.png'));
const target = PNG.sync.read(fs.readFileSync('draft/visual-diff-results/target-leftsidebar.png'));

const width = Math.min(draft.width, target.width);
const height = Math.min(draft.height, target.height);

const diff = new PNG({ width, height });
diff.data.fill(0);

const mismatched = pixelmatch(draft.data, target.data, diff.data, width, height, { threshold: 0.1, includeAA: true });
console.log('Total mismatched:', mismatched);
console.log('Total pixels:', width * height);
console.log('Percent:', (mismatched / (width * height) * 100).toFixed(2) + '%');

// Sample some pixels from the diff buffer
let redCount = 0;
let blackCount = 0;
let otherCount = 0;
for (let i = 0; i < diff.data.length; i += 4) {
  const r = diff.data[i];
  const g = diff.data[i+1];
  const b = diff.data[i+2];
  if (r === 255 && g === 0 && b === 0) redCount++;
  else if (r === 0 && g === 0 && b === 0) blackCount++;
  else otherCount++;
}
console.log('Red pixels (diff):', redCount);
console.log('Black pixels (same):', blackCount);
console.log('Other pixels:', otherCount);
