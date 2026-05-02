const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1920, height: 1080 });

  await page.goto('http://localhost:4000?local=true', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  const sel = '.cards-container > .game-card:first-child';
  const el = await page.$(sel);
  if (!el) { console.log('NOT FOUND'); await browser.close(); return; }
  const styles = await el.evaluate((node) => {
    const cs = window.getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    return {
      width: cs.width,
      height: cs.height,
      padding: cs.padding,
      borderRadius: cs.borderRadius,
      backgroundColor: cs.backgroundColor,
      color: cs.color,
      fontSize: cs.fontSize,
      fontWeight: cs.fontWeight,
      lineHeight: cs.lineHeight,
      boxSizing: cs.boxSizing,
      top: rect.top,
      left: rect.left,
    };
  });
  console.log(JSON.stringify(styles, null, 2));

  await browser.close();
})();
