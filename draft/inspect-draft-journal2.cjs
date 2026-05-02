const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('http://localhost:4000?local=true', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  const allContainers = await page.evaluate(() => {
    const containers = document.querySelectorAll('.journal-container');
    return Array.from(containers).map((c, i) => {
      const rect = c.getBoundingClientRect();
      const cards = c.querySelectorAll('.game-card');
      const vars = c.querySelectorAll('.journal-game-variable, .journal-variable');
      return {
        index: i,
        rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
        cardCount: cards.length,
        varCount: vars.length,
        html: c.outerHTML.slice(0, 500)
      };
    });
  });
  console.log('All journal containers:', JSON.stringify(allContainers, null, 2));

  const allCards = await page.evaluate(() => {
    const cards = document.querySelectorAll('.game-card');
    return Array.from(cards).map((c, i) => {
      const rect = c.getBoundingClientRect();
      return { index: i, text: c.textContent.slice(0, 80), rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height } };
    });
  });
  console.log('\nAll cards:', JSON.stringify(allCards, null, 2));

  await browser.close();
})();
