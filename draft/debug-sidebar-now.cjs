const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1920, height: 1080 });

  await page.goto('http://localhost:4000?local=true', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  const selectors = [
    '#SB1',
    '#SB1 .score-value',
    '#SB1 .score-caption',
    '#SB2',
    '#SB2 .score-value',
    '#SB2 .score-caption',
  ];

  for (const sel of selectors) {
    const el = await page.$(sel);
    if (!el) {
      console.log(`\n=== ${sel}: NOT FOUND ===`);
      continue;
    }
    const styles = await el.evaluate((node) => {
      const cs = window.getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return {
        display: cs.display,
        width: cs.width,
        height: cs.height,
        background: cs.background,
        backgroundColor: cs.backgroundColor,
        backgroundImage: cs.backgroundImage,
        backgroundSize: cs.backgroundSize,
        color: cs.color,
        fontSize: cs.fontSize,
        fontWeight: cs.fontWeight,
        lineHeight: cs.lineHeight,
        position: cs.position,
        top: rect.top,
        left: rect.left,
      };
    });
    console.log(`\n=== ${sel} ===`);
    console.log(JSON.stringify(styles, null, 2));
  }

  await browser.close();
})();
