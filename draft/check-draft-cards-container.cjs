const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1920, height: 1080 });

  await page.goto('http://localhost:4000?local=true', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  const info = await page.evaluate(() => {
    const cardsContainer = document.querySelector('.cards-container');
    if (!cardsContainer) return { error: 'cards-container not found' };
    const children = Array.from(cardsContainer.children).map(c => ({
      tag: c.tagName,
      className: c.className,
      id: c.id,
      text: c.textContent.trim().substring(0, 100),
      rect: c.getBoundingClientRect(),
    }));
    return { children };
  });

  console.log('=== DRAFT cards-container children ===');
  console.log(JSON.stringify(info, null, 2));

  await browser.close();
})();
