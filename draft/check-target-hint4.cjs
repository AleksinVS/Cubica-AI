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
    const vars = document.querySelector('.antarctica-hint-screen .game-variables-container');
    if (!vars) return { error: 'not found' };
    const cs = window.getComputedStyle(vars);
    return {
      width: cs.width,
      maxWidth: cs.maxWidth,
      minWidth: cs.minWidth,
      padding: cs.padding,
      margin: cs.margin,
      boxSizing: cs.boxSizing,
      gridColumn: cs.gridColumn,
      gridColumnStart: cs.gridColumnStart,
      gridColumnEnd: cs.gridColumnEnd,
      justifySelf: cs.justifySelf,
      alignSelf: cs.alignSelf,
    };
  });

  console.log(JSON.stringify(info, null, 2));

  await browser.close();
})();
