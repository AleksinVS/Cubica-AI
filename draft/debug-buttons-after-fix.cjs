const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1920, height: 1080 });

  const res = await fetch('http://localhost:3009/api/runtime/sessions', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gameId: 'antarctica', playerId: 'player-web' })
  });
  const { sessionId } = await res.json();
  await fetch('http://localhost:3009/api/runtime/actions', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, playerId: 'player-web', actionId: 'showScreenWithLeftSideBar' })
  });

  await page.goto('http://localhost:3009', { waitUntil: 'networkidle' });
  await page.evaluate((sid) => localStorage.setItem('cubica-antarctica-session-id', sid), sessionId);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  const selectors = [
    '#btn-journal',
    '#btn-hint',
    '#nav-left',
    '#nav-right',
  ];

  for (const sel of selectors) {
    const el = await page.$(sel);
    if (!el) {
      console.log(`\n=== ${sel}: NOT FOUND ===`);
      continue;
    }
    const styles = await el.evaluate((node) => {
      const cs = window.getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return {
        width: cs.width,
        height: cs.height,
        minHeight: cs.minHeight,
        padding: cs.padding,
        paddingTop: cs.paddingTop,
        paddingBottom: cs.paddingBottom,
        top: rect.top,
        left: rect.left,
      };
    });
    console.log(`\n=== ${sel} ===`);
    console.log(JSON.stringify(styles, null, 2));
  }

  await browser.close();
})();
