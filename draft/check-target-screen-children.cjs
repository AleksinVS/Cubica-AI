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

  const info = await page.evaluate(() => {
    const screen = document.querySelector('.leftsidebar-screen');
    if (!screen) return { error: 'screen not found' };
    return {
      childCount: screen.children.length,
      children: Array.from(screen.children).map(c => ({
        tag: c.tagName,
        className: c.className,
        id: c.id,
        gridColumn: c.style.gridColumn,
        gridRow: c.style.gridRow,
        rect: c.getBoundingClientRect(),
      })),
    };
  });

  console.log(JSON.stringify(info, null, 2));

  await browser.close();
})();
