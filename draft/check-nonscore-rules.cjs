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

  const cdp = await page.context().newCDPSession(page);
  await cdp.send('DOM.enable');
  await cdp.send('CSS.enable');

  const { nodeId } = await cdp.send('DOM.querySelector', {
    nodeId: (await cdp.send('DOM.getDocument')).root.nodeId,
    selector: '.topbar-variables-container .game-variable:not(.game-variable--score)'
  });

  const { matchedCSSRules } = await cdp.send('CSS.getMatchedStylesForNode', { nodeId });

  const widthRules = [];
  for (const r of matchedCSSRules || []) {
    const rule = r.rule;
    const selector = rule.selectorList?.selectors?.map(s => s.text).join(', ') || '';
    for (const prop of rule.style?.cssProperties || []) {
      if (prop.name === 'width' || prop.name === 'min-width' || prop.name === 'max-width') {
        widthRules.push({
          selector,
          property: prop.name,
          value: prop.value,
          important: prop.important || false,
          sourceURL: rule.origin?.stylesheetURL || 'inline',
          line: rule.style?.range?.startLine || 0
        });
      }
    }
  }

  console.log(JSON.stringify(widthRules, null, 2));
  await browser.close();
}

main().catch(console.error);
