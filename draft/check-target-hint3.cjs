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
    body: JSON.stringify({ sessionId, playerId: 'player-web', actionId: 'showHint' })
  });

  await page.goto('http://localhost:3009', { waitUntil: 'networkidle' });
  await page.evaluate((sid) => localStorage.setItem('cubica-antarctica-session-id', sid), sessionId);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  const info = await page.evaluate(() => {
    const screen = document.querySelector('.antarctica-hint-screen');
    const renderer = screen ? screen.closest('.s1-renderer') : null;
    const vars = screen ? screen.querySelector('.game-variables-container') : null;
    return {
      screenRect: screen ? screen.getBoundingClientRect() : null,
      rendererRect: renderer ? renderer.getBoundingClientRect() : null,
      varsRect: vars ? vars.getBoundingClientRect() : null,
    };
  });

  console.log(JSON.stringify(info, null, 2));

  await browser.close();
})();
