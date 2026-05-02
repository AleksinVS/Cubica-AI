const { chromium } = require('playwright');

const TARGET_URL = 'http://localhost:3000';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(TARGET_URL, { waitUntil: 'networkidle', timeout: 30000 });

  for (let i = 0; i < 12; i++) {
    const cards = await page.$$('.cards-container .s1-card, .cards-container .game-card');
    if (cards.length >= 4) { console.log(`Board after ${i} clicks`); break; }
    const btn = await page.$('button:has-text("ПРОДОЛЖИТЬ"), button:has-text("Продолжить")');
    if (btn) { await btn.click(); await page.waitForTimeout(3000); } else break;
  }
  await page.waitForTimeout(1000);

  const result = await page.evaluate(() => {
    const img = document.querySelector('.topbar-variables-container .game-variable--score.game-variable--topbar .game-variable-image.game-variable-visual');
    if (!img) return { error: 'Image not found' };
    const s = getComputedStyle(img);
    return {
      rect: { width: img.getBoundingClientRect().width, height: img.getBoundingClientRect().height },
      width: s.width,
      height: s.height,
      minWidth: s.minWidth,
      minHeight: s.minHeight,
      flex: s.flex,
      flexBasis: s.flexBasis,
      margin: s.margin,
    };
  });

  console.log(JSON.stringify(result, null, 2));
  await browser.close();
}

main().catch(console.error);
