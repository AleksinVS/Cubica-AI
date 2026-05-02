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
    const matches = [];
    for (const sheet of document.styleSheets) {
      try {
        for (const rule of sheet.cssRules || sheet.rules || []) {
          if (rule.type === CSSRule.STYLE_RULE) {
            if (rule.selectorText.includes('topbar-screen-shell') && rule.selectorText.includes('game-variable')) {
              matches.push({
                selector: rule.selectorText,
                width: rule.style.getPropertyValue('width'),
                widthImp: rule.style.getPropertyPriority('width'),
                minWidth: rule.style.getPropertyValue('min-width'),
                minWidthImp: rule.style.getPropertyPriority('min-width'),
                flex: rule.style.getPropertyValue('flex'),
                flexImp: rule.style.getPropertyPriority('flex'),
              });
            }
          }
        }
      } catch (e) {
        matches.push({ error: e.message, href: sheet.href });
      }
    }
    return matches;
  });

  console.log(JSON.stringify(result, null, 2));
  await browser.close();
}

main().catch(console.error);
