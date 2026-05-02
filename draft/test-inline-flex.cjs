const { chromium } = require('playwright');

const TARGET_URL = 'http://localhost:3000';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(TARGET_URL, { waitUntil: 'networkidle' });

  for (let i = 0; i < 12; i++) {
    const cards = await page.$$('.cards-container .s1-card, .cards-container .game-card');
    if (cards.length >= 4) break;
    const btn = await page.$('button:has-text("ПРОДОЛЖИТЬ"), button:has-text("Продолжить")');
    if (btn) { await btn.click(); await page.waitForTimeout(3000); } else break;
  }
  await page.waitForTimeout(1000);

  const result = await page.evaluate(() => {
    const el = document.querySelector('.topbar-variables-container .game-variable:not(.game-variable--score)');
    if (!el) return { error: 'not found' };

    const before = {
      width: getComputedStyle(el).width,
      minWidth: getComputedStyle(el).minWidth,
      flex: getComputedStyle(el).flex,
      flexBasis: getComputedStyle(el).flexBasis,
    };

    el.style.setProperty('flex-basis', 'auto', 'important');
    el.style.setProperty('width', 'auto', 'important');
    el.style.setProperty('min-width', '75px', 'important');

    const after = {
      width: getComputedStyle(el).width,
      minWidth: getComputedStyle(el).minWidth,
      flex: getComputedStyle(el).flex,
      flexBasis: getComputedStyle(el).flexBasis,
    };

    return { before, after, className: el.className };
  });

  console.log(JSON.stringify(result, null, 2));
  await browser.close();
}

main().catch(console.error);
