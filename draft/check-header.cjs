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

  const headerVisible = await page.evaluate(() => {
    const el = document.querySelector('.topbar-board-header');
    if (!el) return 'not found';
    const cs = window.getComputedStyle(el);
    return { display: cs.display, visibility: cs.visibility, height: cs.height };
  });

  const cardsInfo = await page.evaluate(() => {
    const container = document.querySelector('.cards-container');
    const cards = document.querySelectorAll('.cards-container .s1-card');
    if (!container) return { container: 'not found', cardCount: 0 };
    const ccs = window.getComputedStyle(container);
    return {
      containerDisplay: ccs.display,
      containerHeight: ccs.height,
      containerWidth: ccs.width,
      cardCount: cards.length,
      firstCardHeight: cards[0] ? window.getComputedStyle(cards[0]).height : 'none'
    };
  });

  console.log('Board header:', headerVisible);
  console.log('Cards info:', cardsInfo);

  await browser.close();
})();
