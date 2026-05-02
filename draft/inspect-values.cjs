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

  const vals = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('.topbar-variables-container .game-variable-value')).map((el, i) => {
      const cs = window.getComputedStyle(el);
      return { index: i, color: cs.color, fontSize: cs.fontSize, fontWeight: cs.fontWeight };
    });
  });
  console.log(vals);
  await browser.close();
})();
