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

  const btns = await page.evaluate(() => {
    const buttons = document.querySelectorAll('.leftsidebar-screen .bottom-controls-container button');
    return Array.from(buttons).map(b => {
      const cs = window.getComputedStyle(b);
      const rect = b.getBoundingClientRect();
      return {
        id: b.id,
        text: b.textContent.trim().substring(0, 30),
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        computed: {
          width: cs.width,
          height: cs.height,
          minWidth: cs.minWidth,
          minHeight: cs.minHeight,
          padding: cs.padding,
          paddingTop: cs.paddingTop,
          paddingBottom: cs.paddingBottom,
          paddingLeft: cs.paddingLeft,
          paddingRight: cs.paddingRight,
          borderWidth: cs.borderWidth,
          boxSizing: cs.boxSizing,
        }
      };
    });
  });

  console.log(JSON.stringify(btns, null, 2));

  await browser.close();
})();
