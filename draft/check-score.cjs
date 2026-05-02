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

  const scoreImg = await page.$('.game-variable--score .game-variable-image');
  if (scoreImg) {
    const styles = await scoreImg.evaluate(el => {
      const cs = window.getComputedStyle(el);
      return {
        width: cs.width,
        height: cs.height,
        backgroundImage: cs.backgroundImage,
      };
    });
    console.log('Score image styles:', styles);
  } else {
    console.log('Score image not found');
  }

  // Also check non-score
  const nonScoreImg = await page.$('.game-variable--pro .game-variable-image');
  if (nonScoreImg) {
    const styles = await nonScoreImg.evaluate(el => {
      const cs = window.getComputedStyle(el);
      return {
        width: cs.width,
        height: cs.height,
      };
    });
    console.log('Non-score image styles:', styles);
  }

  await browser.close();
})();
