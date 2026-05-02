const fs = require('fs');
const { PNG } = require('pngjs');
const pixelmatch = require('pixelmatch').default || require('pixelmatch');

const draft = PNG.sync.read(fs.readFileSync('/home/abc/projects/Cubica-AI/draft/visual-diff-results/draft-journal.png'));
const manual = PNG.sync.read(fs.readFileSync('/home/abc/projects/Cubica-AI/draft/real-journal-manual.png'));
const width = Math.min(draft.width, manual.width);
const height = Math.min(draft.height, manual.height);
const diff = new PNG({ width, height });
const diffPixels = pixelmatch(draft.data, manual.data, diff.data, width, height, { threshold: 0.1, includeAA: true });
fs.writeFileSync('/home/abc/projects/Cubica-AI/draft/diff-manual-journal.png', PNG.sync.write(diff));
const totalPixels = width * height;
console.log(`Manual vs Draft: ${(diffPixels / totalPixels * 100).toFixed(2)}% (${diffPixels.toLocaleString()} pixels)`);
