const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1920, height: 1080 });

  await page.goto('http://localhost:4000?local=true', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  const sel = '.cards-container';
  const el = await page.$(sel);
  if (!el) { console.log('NOT FOUND'); await browser.close(); return; }
  const rect = await el.evaluate(n => {
    const r = n.getBoundingClientRect();
    return { top: r.top, left: r.left, width: r.width, height: r.height };
  });
  console.log(JSON.stringify(rect, null, 2));

  await browser.close();
})();
