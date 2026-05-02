const { chromium } = require('playwright');

const TARGET_URL = 'http://localhost:3000';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(TARGET_URL, { waitUntil: 'networkidle' });
  for (let i = 0; i < 12; i++) {
    const cards = await page.$$eval('.cards-container .s1-card, .cards-container .game-card', el => el.length);
    if (cards >= 4) break;
    const btn = await page.$('button:has-text("ПРОДОЛЖИТЬ"), button:has-text("Продолжить")');
    if (btn) { await btn.click(); await page.waitForTimeout(3000); } else break;
  }
  await page.waitForTimeout(1000);

  const info = await page.evaluate(() => {
    const card = document.querySelector('.topbar-screen-shell .cards-container > .s1-card');
    if (!card) return { error: 'No card found' };
    const s = getComputedStyle(card);
    return {
      width: s.width,
      padding: s.padding,
      backgroundColor: s.backgroundColor,
      backgroundImage: s.backgroundImage,
      borderRadius: s.borderRadius,
      border: s.border,
      boxShadow: s.boxShadow,
      color: s.color,
      fontWeight: s.fontWeight,
      lineHeight: s.lineHeight,
    };
  });

  console.log(JSON.stringify(info, null, 2));
  await browser.close();
}

main().catch(console.error);
