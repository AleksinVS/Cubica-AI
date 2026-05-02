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

    const rules = [];
    for (const sheet of document.styleSheets) {
      try {
        for (const rule of sheet.cssRules || sheet.rules || []) {
          if (rule.type !== CSSRule.STYLE_RULE) continue;
          if (!el.matches(rule.selectorText)) continue;
          const w = rule.style.getPropertyValue('width');
          const wImp = rule.style.getPropertyPriority('width');
          const mw = rule.style.getPropertyValue('min-width');
          const mwImp = rule.style.getPropertyPriority('min-width');
          if (w || mw) {
            rules.push({
              selector: rule.selectorText,
              width: w,
              widthImportant: wImp === 'important',
              minWidth: mw,
              minWidthImportant: mwImp === 'important',
            });
          }
        }
      } catch (e) {
        // cross-origin stylesheet
      }
    }

    return {
      className: el.className,
      inlineWidth: el.style.width,
      computedWidth: getComputedStyle(el).width,
      computedMinWidth: getComputedStyle(el).minWidth,
      rules,
    };
  });

  console.log(JSON.stringify(result, null, 2));
  await browser.close();
}

main().catch(console.error);
