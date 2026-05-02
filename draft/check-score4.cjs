const { chromium } = require('playwright');

const TARGET_URL = 'http://localhost:3000';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(TARGET_URL, { waitUntil: 'networkidle' });

  for (let i = 0; i < 12; i++) {
    const cards = await page.$$('.cards-container .s1-card, .cards-container .game-card');
    if (cards.length >= 4) { console.log(`Board after ${i} clicks`); break; }
    const btn = await page.$('button:has-text("ПРОДОЛЖИТЬ"), button:has-text("Продолжить")');
    if (btn) { await btn.click(); await page.waitForTimeout(3000); } else break;
  }
  await page.waitForTimeout(1000);

  const result = await page.evaluate(() => {
    const parent = document.querySelector('.topbar-variables-container .game-variable--score.game-variable--topbar');
    if (!parent) return { error: 'Parent not found' };

    const s = getComputedStyle(parent);
    const children = Array.from(parent.children).map(c => ({
      tag: c.tagName,
      class: c.className,
      rect: { width: c.getBoundingClientRect().width, height: c.getBoundingClientRect().height },
      computedHeight: getComputedStyle(c).height,
      computedMarginTop: getComputedStyle(c).marginTop,
      computedMarginBottom: getComputedStyle(c).marginBottom,
    }));

    return {
      rect: { width: parent.getBoundingClientRect().width, height: parent.getBoundingClientRect().height },
      display: s.display,
      height: s.height,
      minHeight: s.minHeight,
      maxHeight: s.maxHeight,
      width: s.width,
      minWidth: s.minWidth,
      maxWidth: s.maxWidth,
      flexDirection: s.flexDirection,
      alignItems: s.alignItems,
      justifyContent: s.justifyContent,
      gap: s.gap,
      padding: s.padding,
      boxSizing: s.boxSizing,
      overflow: s.overflow,
      position: s.position,
      children,
      parentInnerHTML: parent.innerHTML.slice(0, 500),
    };
  });

  console.log(JSON.stringify(result, null, 2));
  await browser.close();
}

main().catch(console.error);
