const { chromium } = require('playwright');

async function inspectVariables(url, label) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);

  if (label === 'TARGET') {
    for (let i = 0; i < 12; i++) {
      const cards = await page.$$('.cards-container .s1-card');
      if (cards.length >= 4) break;
      const btn = await page.$('button:has-text("ПРОДОЛЖИТЬ"), button:has-text("Продолжить")');
      if (btn) { await btn.click(); await page.waitForTimeout(3000); }
      else break;
    }
  }

  const vars = await page.evaluate(() => {
    const container = document.querySelector('.game-variables-container');
    if (!container) return { container: null, items: [] };
    const ccs = window.getComputedStyle(container);
    const items = Array.from(container.querySelectorAll('.game-variable')).map((el, i) => {
      const cs = window.getComputedStyle(el);
      const child = el.querySelector('button, .game-variable-value, .game-variable-image');
      const childCs = child ? window.getComputedStyle(child) : null;
      return {
        index: i,
        tagName: el.tagName,
        className: el.className,
        width: cs.width,
        height: cs.height,
        display: cs.display,
        flexDirection: cs.flexDirection,
        justifyContent: cs.justifyContent,
        alignItems: cs.alignItems,
        padding: cs.padding,
        margin: cs.margin,
        backgroundColor: cs.backgroundColor,
        backgroundImage: cs.backgroundImage,
        color: cs.color,
        childTag: child ? child.tagName : null,
        childWidth: childCs ? childCs.width : null,
        childHeight: childCs ? childCs.height : null,
        childBackgroundImage: childCs ? childCs.backgroundImage : null,
        childColor: childCs ? childCs.color : null,
        childFontSize: childCs ? childCs.fontSize : null,
      };
    });
    return {
      container: {
        width: ccs.width,
        height: ccs.height,
        display: ccs.display,
        flexDirection: ccs.flexDirection,
        justifyContent: ccs.justifyContent,
        alignItems: ccs.alignItems,
        padding: ccs.padding,
        gap: ccs.gap,
      },
      items
    };
  });

  console.log(`\n=== ${label} Variables ===`);
  console.log('Container:', JSON.stringify(vars.container, null, 2));
  vars.items.forEach(v => {
    console.log(`Item ${v.index} (${v.className}):`, JSON.stringify(v, null, 2));
  });

  await browser.close();
}

(async () => {
  await inspectVariables('http://localhost:4000?local=true', 'DRAFT');
  await inspectVariables('http://localhost:3000', 'TARGET');
})();
