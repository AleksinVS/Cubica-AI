const fs = require('fs');
const { PNG } = require('pngjs');

const img = PNG.sync.read(fs.readFileSync('/home/abc/projects/Cubica-AI/draft/visual-diff-results/draft-leftsidebar.png'));

function getPixel(x, y) {
  const idx = (y * img.width + x) * 4;
  return { r: img.data[idx], g: img.data[idx+1], b: img.data[idx+2] };
}

const p1 = getPixel(100, 100);
const p2 = getPixel(600, 100);
const p3 = getPixel(1000, 500);
const p4 = getPixel(1700, 500);

console.log('Sidebar area (100,100):', p1);
console.log('Main area (600,100):', p2);
console.log('Center (1000,500):', p3);
console.log('Right side (1700,500):', p4);
