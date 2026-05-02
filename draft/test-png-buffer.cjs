const { PNG } = require('pngjs');

const p = new PNG({ width: 10, height: 10 });
console.log('Before fill:', p.data[0], p.data[1], p.data[2], p.data[3]);
p.data.fill(0);
console.log('After fill:', p.data[0], p.data[1], p.data[2], p.data[3]);

// Set one pixel to red
p.data[0] = 255;
p.data[1] = 0;
p.data[2] = 0;
p.data[3] = 255;

let count = 0;
for (let i = 0; i < p.data.length; i += 4) {
  if (p.data[i] > 0 || p.data[i+1] > 0 || p.data[i+2] > 0) count++;
}
console.log('Non-zero pixels:', count, '/', 10*10);
