const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('http://localhost:4000?local=true', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  const selectors = [
    '.journal-container',
    '.journal-cards-container',
    '.journal-container .game-card',
    '.journal-variables-container',
    '.journal-game-variable',
    '.journal-variable__value',
    '.journal-variable__caption',
    '.journal-variable__diff',
  ];

  for (const sel of selectors) {
    const style = await page.evaluate((s) => {
      const el = document.querySelector(s);
      if (!el) return null;
      const cs = getComputedStyle(el);
      return {
        selector: s,
        display: cs.display,
        flexDirection: cs.flexDirection,
        flexWrap: cs.flexWrap,
        gap: cs.gap,
        padding: cs.padding,
        margin: cs.margin,
        width: cs.width,
        height: cs.height,
        minHeight: cs.minHeight,
        fontSize: cs.fontSize,
        fontWeight: cs.fontWeight,
        color: cs.color,
        backgroundColor: cs.backgroundColor,
        backgroundImage: cs.backgroundImage,
        borderRadius: cs.borderRadius,
        justifyContent: cs.justifyContent,
        alignItems: cs.alignItems,
      };
    }, sel);
    console.log(JSON.stringify(style, null, 2));
    console.log('---');
  }

  await browser.close();
})();
