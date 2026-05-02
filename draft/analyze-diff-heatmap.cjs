const fs = require('fs');
const { PNG } = require('pngjs');
const pixelmatch = require('pixelmatch').default;

const draftPath = 'draft/visual-diff-results/draft-topbar.png';
const targetPath = 'draft/visual-diff-results/target-topbar.png';
const diffPath = 'draft/visual-diff-results/diff-topbar.png';

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

fs.writeFileSync(diffPath, PNG.sync.write(diff));

// Find bounding boxes of diff clusters
function findClusters(threshold = 50) {
  const visited = new Set();
  const clusters = [];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const r = diff.data[idx];
      if (r < threshold || visited.has(`${x},${y}`)) continue;

      // BFS
      const queue = [[x, y]];
      let minX = x, maxX = x, minY = y, maxY = y;
      let count = 0;
      visited.add(`${x},${y}`);

      while (queue.length > 0) {
        const [cx, cy] = queue.pop();
        count++;
        minX = Math.min(minX, cx);
        maxX = Math.max(maxX, cx);
        minY = Math.min(minY, cy);
        maxY = Math.max(maxY, cy);

        for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            if (dx === 0 && dy === 0) continue;
            const nx = cx + dx, ny = cy + dy;
            if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
            const key = `${nx},${ny}`;
            if (visited.has(key)) continue;
            const nIdx = (ny * width + nx) * 4;
            if (diff.data[nIdx] >= threshold) {
              visited.add(key);
              queue.push([nx, ny]);
            }
          }
        }
      }

      clusters.push({ x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1, count });
    }
  }

  return clusters.sort((a, b) => b.count - a.count);
}

const clusters = findClusters(50);
console.log(`Total diff pixels: ${diffPixels.toLocaleString()}`);
console.log(`Top 15 diff clusters:`);
for (let i = 0; i < Math.min(15, clusters.length); i++) {
  const c = clusters[i];
  console.log(`  #${i+1}: x=${c.x}, y=${c.y}, w=${c.w}, h=${c.h}, pixels=${c.count.toLocaleString()}`);
}
