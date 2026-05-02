const { chromium } = require('playwright');

const TARGET_URL = 'http://localhost:3000';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(TARGET_URL, { waitUntil: 'networkidle' });

  let clicks = 0;
  for (let i = 0; i < 12; i++) {
    const cards = await page.$$('.cards-container .s1-card, .cards-container .game-card');
    const screen = await page.$eval('.s1-screen', el => el.className).catch(() => 'no .s1-screen');
    console.log(`Step ${i}: cards=${cards.length}, screen="${screen}"`);
    if (cards.length >= 4) { clicks = i; break; }
    const btn = await page.$('button:has-text("ПРОДОЛЖИТЬ"), button:has-text("Продолжить")');
    if (btn) { await btn.click(); await page.waitForTimeout(3000); } else { clicks = i; break; }
  }
  await page.waitForTimeout(1000);

  const result = await page.evaluate(() => {
    const el = document.querySelector('.topbar-variables-container .game-variable:not(.game-variable--score)');
    if (!el) return { error: 'not found' };
    const parent = el.parentElement;
    const grandparent = parent?.parentElement;
    return {
      className: el.className,
      parentClassName: parent?.className,
      grandparentClassName: grandparent?.className,
      screenHTML: grandparent?.outerHTML?.slice(0, 200),
    };
  });

  console.log(JSON.stringify(result, null, 2));
  await browser.close();
}

main().catch(console.error);
