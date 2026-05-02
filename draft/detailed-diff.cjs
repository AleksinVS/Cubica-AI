const { chromium } = require('playwright');
const { PNG } = require('pngjs');
const fs = require('fs');

const DRAFT_URL = 'http://localhost:4000?local=true';
const TARGET_URL = 'http://localhost:3000';

async function capture(page, url, advance) {
  await page.goto(url, { waitUntil: 'networkidle' });
  if (advance) {
    for (let i = 0; i < 12; i++) {
      const cards = await page.$$('.cards-container .s1-card, .cards-container .game-card');
      if (cards.length >= 4) break;
      const btn = await page.$('button:has-text("ПРОДОЛЖИТЬ"), button:has-text("Продолжить")');
      if (btn) { await btn.click(); await page.waitForTimeout(3000); } else break;
    }
  }
  await page.waitForTimeout(1000);
  return await page.screenshot({ fullPage: false });
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.setViewportSize({ width: 1920, height: 1080 });

  const draftBuf = await capture(page, DRAFT_URL, false);
  const targetBuf = await capture(page, TARGET_URL, true);

  const draft = PNG.sync.read(draftBuf);
  const target = PNG.sync.read(targetBuf);

  const width = Math.min(draft.width, target.width);
  const height = Math.min(draft.height, target.height);

  // Analyze diffs in specific regions
  const regions = [
    { name: 'header-left', x: [200, 500], y: [20, 150] },
    { name: 'header-center', x: [700, 1100], y: [20, 150] },
    { name: 'header-right', x: [1300, 1700], y: [20, 150] },
    { name: 'card1', x: [400, 700], y: [200, 500] },
    { name: 'card2', x: [800, 1100], y: [200, 500] },
    { name: 'card3', x: [1200, 1500], y: [200, 500] },
    { name: 'card4', x: [400, 700], y: [580, 880] },
    { name: 'card5', x: [800, 1100], y: [580, 880] },
    { name: 'card6', x: [1200, 1500], y: [580, 880] },
    { name: 'bg-left', x: [20, 100], y: [200, 500] },
    { name: 'bg-right', x: [1800, 1900], y: [200, 500] },
  ];

  for (const r of regions) {
    let diffSum = 0;
    let count = 0;
    let identical = 0;
    let maxDiff = 0;
    for (let y = r.y[0]; y < r.y[1]; y++) {
      for (let x = r.x[0]; x < r.x[1]; x++) {
        const idx = (y * width + x) * 4;
        const d = [draft.data[idx], draft.data[idx+1], draft.data[idx+2]];
        const t = [target.data[idx], target.data[idx+1], target.data[idx+2]];
        const diffVal = Math.abs(d[0]-t[0]) + Math.abs(d[1]-t[1]) + Math.abs(d[2]-t[2]);
        diffSum += diffVal;
        if (diffVal === 0) identical++;
        if (diffVal > maxDiff) maxDiff = diffVal;
        count++;
      }
    }
    const avgDiff = diffSum / count;
    const pctIdentical = (identical / count * 100).toFixed(1);
    console.log(`${r.name}: avgDiff=${avgDiff.toFixed(1)} maxDiff=${maxDiff} identical=${pctIdentical}%`);
  }

  // Save screenshots for manual inspection
  fs.writeFileSync('draft/visual-diff-results/draft-current.png', draftBuf);
  fs.writeFileSync('draft/visual-diff-results/target-current.png', targetBuf);
  console.log('\nSaved draft-current.png and target-current.png');

  await browser.close();
}

main().catch(console.error);
