const { chromium } = require('playwright');

const TARGET_URL = 'http://localhost:3000';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(TARGET_URL, { waitUntil: 'networkidle' });
  for (let i = 0; i < 12; i++) {
    const cards = await page.$$eval('.cards-container .s1-card, .cards-container .game-card', el => el.length);
    if (cards >= 4) break;
    const btn = await page.$('button:has-text("ПРОДОЛЖИТЬ"), button:has-text("Продолжить")');
    if (btn) { await btn.click(); await page.waitForTimeout(3000); } else break;
  }
  await page.waitForTimeout(1000);

  const info = await page.evaluate(() => {
    const el = document.querySelector('.game-variable--score.game-variable--topbar');
    if (!el) return { error: 'No score var found' };
    const s = getComputedStyle(el);
    return {
      className: el.className,
      inlineHeight: el.style.height,
      inlineMinHeight: el.style.minHeight,
      inlineDisplay: el.style.display,
      computedHeight: s.height,
      computedMinHeight: s.minHeight,
      computedDisplay: s.display,
      computedBoxSizing: s.boxSizing,
      computedPadding: s.padding,
      computedMargin: s.margin,
      parentDisplay: getComputedStyle(el.parentElement).display,
      parentAlignItems: getComputedStyle(el.parentElement).alignItems,
      parentHeight: getComputedStyle(el.parentElement).height,
    };
  });

  console.log(JSON.stringify(info, null, 2));
  await browser.close();
}

main().catch(console.error);
