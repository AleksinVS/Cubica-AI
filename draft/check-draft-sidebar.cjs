const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1920, height: 1080 });

  await page.goto('http://localhost:4000?local=true', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  // Inspect sidebar
  const sidebarInfo = await page.evaluate(() => {
    const sidebar = document.querySelector('.sidebar');
    if (!sidebar) return { error: 'sidebar not found' };
    const vars = Array.from(sidebar.querySelectorAll('.game-variable, .default-game-variable'));
    return {
      className: sidebar.className,
      childCount: sidebar.children.length,
      metrics: vars.map(v => ({
        className: v.className,
        text: v.textContent.trim().substring(0, 50),
        rect: v.getBoundingClientRect(),
      })),
    };
  });

  console.log('Draft sidebar:', JSON.stringify(sidebarInfo, null, 2));

  // Inspect cards container
  const cardsInfo = await page.evaluate(() => {
    const cards = document.querySelector('.cards-container');
    if (!cards) return { error: 'cards not found' };
    return {
      className: cards.className,
      rect: cards.getBoundingClientRect(),
      childCount: cards.children.length,
    };
  });

  console.log('Draft cards:', JSON.stringify(cardsInfo, null, 2));

  await browser.close();
})();
