const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  for (let i = 0; i < 12; i++) {
    const cards = await page.$$('.cards-container .s1-card');
    if (cards.length >= 4) break;
    const btn = await page.$('button:has-text("ПРОДОЛЖИТЬ"), button:has-text("Продолжить")');
    if (btn) { await btn.click(); await page.waitForTimeout(3000); }
    else break;
  }

  const html = await page.evaluate(() => {
    const score = document.querySelector('.game-variable--score');
    return score ? score.outerHTML : 'not found';
  });
  console.log('Score variable HTML:', html);
  await browser.close();
})();
