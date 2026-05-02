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

  const result = await page.evaluate(() => {
    const score = document.querySelector('.game-variable--score');
    if (!score) return 'score not found';
    const img = score.querySelector('.game-variable-image');
    const val = score.querySelector('.game-variable-value');
    return {
      scoreOuterHeight: score.getBoundingClientRect().height,
      imgRect: img ? { width: img.getBoundingClientRect().width, height: img.getBoundingClientRect().height } : null,
      imgComputed: img ? { width: window.getComputedStyle(img).width, height: window.getComputedStyle(img).height, minHeight: window.getComputedStyle(img).minHeight } : null,
      valComputed: val ? { width: window.getComputedStyle(val).width, height: window.getComputedStyle(val).height, fontSize: window.getComputedStyle(val).fontSize } : null,
    };
  });
  console.log(result);
  await browser.close();
})();
