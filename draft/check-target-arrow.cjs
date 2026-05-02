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

  const info = await page.evaluate(() => {
    const btn = document.querySelector('.topbar-screen-shell .button-helper-arrow');
    if (!btn) return null;
    const r = btn.getBoundingClientRect();
    const s = getComputedStyle(btn);
    return {
      tag: btn.tagName,
      className: btn.className,
      id: btn.id,
      inlineWidth: btn.style.width,
      inlineHeight: btn.style.height,
      inlineDisplay: btn.style.display,
      width: r.width,
      height: r.height,
      fontSize: s.fontSize,
      lineHeight: s.lineHeight,
      padding: s.padding,
      margin: s.margin,
      display: s.display,
      boxSizing: s.boxSizing,
      allRules: Array.from(document.styleSheets).flatMap(sheet => {
        try {
          return Array.from(sheet.cssRules).filter(rule => {
            try {
              return btn.matches(rule.selectorText);
            } catch (e) { return false; }
          }).map(rule => ({
            selector: rule.selectorText,
            cssText: rule.style.cssText,
          }));
        } catch (e) { return []; }
      }),
    };
  });
  console.log(JSON.stringify(info, null, 2));

  await browser.close();
}

main().catch(console.error);
