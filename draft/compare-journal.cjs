const fs = require('fs');
const { PNG } = require('pngjs');
const pixelmatch = require('pixelmatch').default || require('pixelmatch');

const draftPath = '/home/abc/projects/Cubica-AI/draft/visual-diff-results/draft-journal.png';
const targetPath = '/home/abc/projects/Cubica-AI/draft/visual-diff-results/target-journal.png';
const diffPath = '/home/abc/projects/Cubica-AI/draft/visual-diff-results/diff-journal.png';

const draft = PNG.sync.read(fs.readFileSync(draftPath));
const target = PNG.sync.read(fs.readFileSync(targetPath));
const width = Math.min(draft.width, target.width);
const height = Math.min(draft.height, target.height);
const diff = new PNG({ width, height });

const diffPixels = pixelmatch(draft.data, target.data, diff.data, width, height, { threshold: 0.1, includeAA: true });
fs.writeFileSync(diffPath, PNG.sync.write(diff));

const totalPixels = width * height;
const diffPercentage = (diffPixels / totalPixels) * 100;

console.log(`Different pixels: ${diffPixels.toLocaleString()}`);
console.log(`Difference: ${diffPercentage.toFixed(2)}%`);
console.log(`Resolution: ${width}x${height}`);

if (diffPercentage > 5) {
  console.log('⚠️  SIGNIFICANT VISUAL DIFFERENCE DETECTED');
} else if (diffPercentage > 1) {
  console.log('⚠️  Minor visual differences');
} else {
  console.log('✅ Visual match acceptable');
}
