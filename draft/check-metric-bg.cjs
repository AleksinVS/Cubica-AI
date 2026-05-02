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
    body: JSON.stringify({ sessionId, playerId: 'player-web', actionId: 'showHistory' })
  });

  await page.goto('http://localhost:3009', { waitUntil: 'networkidle' });
  await page.evaluate((sid) => localStorage.setItem('cubica-antarctica-session-id', sid), sessionId);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  const styles = await page.evaluate(() => {
    const img = document.querySelector('.journal-variables-container .game-variable--topbar .game-variable-image');
    if (!img) return null;
    const cs = window.getComputedStyle(img);
    return {
      backgroundImage: cs.backgroundImage,
      backgroundColor: cs.backgroundColor,
      display: cs.display,
      width: cs.width,
      height: cs.height,
    };
  });
  console.log('Metric image style:', styles);

  await browser.close();
})();
