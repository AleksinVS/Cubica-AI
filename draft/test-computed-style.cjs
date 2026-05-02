const { chromium } = require('playwright');

(async () => {
  const res = await fetch('http://localhost:3009/api/runtime/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gameId: 'antarctica', playerId: 'player-web' })
  });
  const data = await res.json();

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('http://localhost:3009', { waitUntil: 'networkidle' });
  await page.evaluate((sid) => {
    localStorage.setItem('cubica-antarctica-session-id', sid);
  }, data.sessionId);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(5000);

  const computed = await page.evaluate(() => {
    const el = document.querySelector('.additional-background');
    if (!el) return { found: false };
    const style = window.getComputedStyle(el);
    return {
      found: true,
      pointerEvents: style.pointerEvents,
      zIndex: style.zIndex,
      gridColumn: style.gridColumn,
      gridRow: style.gridRow,
    };
  });

  console.log('Computed style:', JSON.stringify(computed, null, 2));
  await browser.close();
})();
