const { chromium } = require('playwright');

const TARGET_URL = 'http://localhost:3000';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.setViewportSize({ width: 1920, height: 1080 });
  // Force no cache
  await page.goto(TARGET_URL, { waitUntil: 'networkidle', timeout: 30000 });

  for (let i = 0; i < 12; i++) {
    const cards = await page.$$('.cards-container .s1-card, .cards-container .game-card');
    if (cards.length >= 4) { console.log(`Board after ${i} clicks`); break; }
    const btn = await page.$('button:has-text("ПРОДОЛЖИТЬ"), button:has-text("Продолжить")');
    if (btn) { await btn.click(); await page.waitForTimeout(3000); } else break;
  }
  await page.waitForTimeout(1000);

  const result = await page.evaluate(() => {
    const parent = document.querySelector('.topbar-variables-container .game-variable--score.game-variable--topbar');
    if (!parent) return { error: 'Parent not found' };
    const s = getComputedStyle(parent);
    return {
      rect: { width: parent.getBoundingClientRect().width, height: parent.getBoundingClientRect().height },
      display: s.display,
      height: s.height,
      minHeight: s.minHeight,
      width: s.width,
      minWidth: s.minWidth,
      padding: s.padding,
      boxSizing: s.boxSizing,
    };
  });

  console.log(JSON.stringify(result, null, 2));
  await browser.close();
}

main().catch(console.error);
