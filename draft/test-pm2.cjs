const fs = require('fs');
const { PNG } = require('pngjs');
const pixelmatch = require('pixelmatch').default;

const w = 10, h = 10;
const img1 = Buffer.alloc(w * h * 4);
const img2 = Buffer.alloc(w * h * 4);

// Fill img1 with blue, img2 with same blue
for (let i = 0; i < w * h; i++) {
  img1[i*4] = 28; img1[i*4+1] = 116; img1[i*4+2] = 169; img1[i*4+3] = 255;
  img2[i*4] = 28; img2[i*4+1] = 116; img2[i*4+2] = 169; img2[i*4+3] = 255;
}

const diff = Buffer.alloc(w * h * 4);
diff.fill(0);

const count = pixelmatch(img1, img2, diff, w, h, { threshold: 0.1, includeAA: false });
console.log(`Diff count: ${count}`);
console.log(`Diff pixel 0: [${diff[0]},${diff[1]},${diff[2]},${diff[3]}]`);

// Now make img2 slightly different at pixel 0
img2[0] = 30; img2[1] = 118; img2[2] = 171;
const diff2 = Buffer.alloc(w * h * 4);
diff2.fill(0);
const count2 = pixelmatch(img1, img2, diff2, w, h, { threshold: 0.1, includeAA: false });
console.log(`Diff count2: ${count2}`);
console.log(`Diff2 pixel 0: [${diff2[0]},${diff2[1]},${diff2[2]},${diff2[3]}]`);
console.log(`Diff2 pixel 1: [${diff2[4]},${diff2[5]},${diff2[6]},${diff2[7]}]`);
