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
    '.leftsidebar-screen .main-content-area',
    '.leftsidebar-screen .cards-container',
    '.leftsidebar-screen .bottom-controls-container',
    '.leftsidebar-screen .bottom-controls-container #btn-journal',
    '.leftsidebar-screen .bottom-controls-container #nav-left',
  ];

  for (const sel of selectors) {
    const el = await page.$(sel);
    if (!el) { console.log(`\n=== ${sel}: NOT FOUND ===`); continue; }
    const rect = await el.evaluate(n => {
      const r = n.getBoundingClientRect();
      const cs = window.getComputedStyle(n);
      return {
        top: r.top, left: r.left, width: r.width, height: r.height,
        display: cs.display, gridRow: cs.gridRow, gridColumn: cs.gridColumn,
        position: cs.position,
      };
    });
    console.log(`\n=== ${sel} ===`);
    console.log(JSON.stringify(rect, null, 2));
  }

  await browser.close();
})();
