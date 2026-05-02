const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1920, height: 1080 });

  await page.goto('http://localhost:4000?local=true', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  const info = await page.evaluate(() => {
    const cards = document.querySelector('.cards-container');
    if (!cards) return { error: 'cards not found' };
    const cs = window.getComputedStyle(cards);
    const firstCard = cards.querySelector('.game-card');
    const cardCs = firstCard ? window.getComputedStyle(firstCard) : null;
    return {
      cards: {
        rect: cards.getBoundingClientRect(),
        padding: cs.padding,
        paddingTop: cs.paddingTop,
        paddingRight: cs.paddingRight,
        paddingBottom: cs.paddingBottom,
        paddingLeft: cs.paddingLeft,
        gap: cs.gap,
        gridTemplateColumns: cs.gridTemplateColumns,
        gridTemplateRows: cs.gridTemplateRows,
        alignContent: cs.alignContent,
        overflow: cs.overflow,
      },
      card: cardCs ? {
        rect: firstCard.getBoundingClientRect(),
        padding: cardCs.padding,
        backgroundColor: cardCs.backgroundColor,
        borderRadius: cardCs.borderRadius,
        fontSize: cardCs.fontSize,
        lineHeight: cardCs.lineHeight,
        width: cardCs.width,
        height: cardCs.height,
      } : null,
    };
  });

  console.log(JSON.stringify(info, null, 2));

  await browser.close();
})();
