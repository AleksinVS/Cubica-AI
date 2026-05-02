const { chromium } = require('playwright');

async function extractStyles(page, url, label) {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  
  // Advance target to board screen
  if (label === 'TARGET') {
    for (let i = 0; i < 12; i++) {
      const cards = await page.$$('.cards-container .s1-card');
      if (cards.length >= 4) break;
      const btn = await page.$('button:has-text("ПРОДОЛЖИТЬ"), button:has-text("Продолжить")');
      if (btn) { await btn.click(); await page.waitForTimeout(3000); }
      else break;
    }
  }
  
  // Wait for draft main screen
  if (label === 'DRAFT') {
    await page.waitForSelector('.default-main-screen', { timeout: 15000 });
    await page.waitForTimeout(1000);
  }

  const selectors = [
    { name: 'screen', selector: '.default-main-screen, .topbar-screen-shell' },
    { name: 'variables-container', selector: '.game-variables-container' },
    { name: 'card', selector: '.game-card, .cards-container .s1-card' },
    { name: 'button', selector: '.button-container .button-helper, .button-container .s1-button, .button-container .action-button' },
  ];

  const results = {};
  for (const { name, selector } of selectors) {
    const el = await page.$(selector);
    if (!el) {
      results[name] = { found: false };
      continue;
    }
    const styles = await el.evaluate((node) => {
      const cs = window.getComputedStyle(node);
      return {
        backgroundColor: cs.backgroundColor,
        backgroundImage: cs.backgroundImage,
        color: cs.color,
        fontSize: cs.fontSize,
        fontFamily: cs.fontFamily,
        padding: cs.padding,
        margin: cs.margin,
        border: cs.border,
        borderRadius: cs.borderRadius,
        width: cs.width,
        height: cs.height,
        display: cs.display,
        gap: cs.gap,
        gridTemplateColumns: cs.gridTemplateColumns,
        flexDirection: cs.flexDirection,
        justifyContent: cs.justifyContent,
        alignItems: cs.alignItems,
      };
    });
    results[name] = { found: true, styles };
  }

  return { label, results };
}

function printComparison(draft, target) {
  console.log('\n=== Style Comparison (Advanced Target) ===\n');
  for (const key of Object.keys(draft.results)) {
    console.log(`--- ${key} ---`);
    const d = draft.results[key];
    const t = target.results[key];

    if (!d.found && !t.found) {
      console.log('  Not found in either');
      continue;
    }
    if (!d.found) {
      console.log('  Draft: NOT FOUND');
      console.log('  Target:', JSON.stringify(t.styles, null, 2).replace(/\n/g, '\n  '));
      continue;
    }
    if (!t.found) {
      console.log('  Draft:', JSON.stringify(d.styles, null, 2).replace(/\n/g, '\n  '));
      console.log('  Target: NOT FOUND');
      continue;
    }

    for (const prop of Object.keys(d.styles)) {
      if (d.styles[prop] !== t.styles[prop]) {
        console.log(`  ${prop}:`);
        console.log(`    Draft:  ${d.styles[prop]}`);
        console.log(`    Target: ${t.styles[prop]}`);
      }
    }
  }
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const draftPage = await context.newPage();
  const targetPage = await context.newPage();

  const draftData = await extractStyles(draftPage, 'http://localhost:4000?local=true', 'DRAFT');
  const targetData = await extractStyles(targetPage, 'http://localhost:3000', 'TARGET');

  printComparison(draftData, targetData);
  await browser.close();
})();
