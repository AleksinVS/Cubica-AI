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
    if (cards.length >= 4) break;
    const btn = await page.$('button:has-text("ПРОДОЛЖИТЬ"), button:has-text("Продолжить")');
    if (btn) { await btn.click(); await page.waitForTimeout(3000); } else break;
  }
  await page.waitForTimeout(1000);

  const result = await page.evaluate(() => {
    const el = document.querySelector('.topbar-variables-container .game-variable:not(.game-variable--score)');
    if (!el) return { error: 'not found' };
    return {
      styleAttr: el.getAttribute('style'),
      inlineWidth: el.style.getPropertyValue('width'),
      inlineWidthImp: el.style.getPropertyPriority('width'),
      inlineMinWidth: el.style.getPropertyValue('min-width'),
      inlineMinWidthImp: el.style.getPropertyPriority('min-width'),
      inlineFlex: el.style.getPropertyValue('flex'),
      inlineFlexImp: el.style.getPropertyPriority('flex'),
      inlineFlexBasis: el.style.getPropertyValue('flex-basis'),
      inlineFlexBasisImp: el.style.getPropertyPriority('flex-basis'),
      computedWidth: getComputedStyle(el).width,
      computedMinWidth: getComputedStyle(el).minWidth,
      computedFlex: getComputedStyle(el).flex,
      computedFlexBasis: getComputedStyle(el).flexBasis,
    };
  });

  console.log(JSON.stringify(result, null, 2));
  await browser.close();
}

main().catch(console.error);
