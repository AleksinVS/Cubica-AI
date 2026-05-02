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

  const metrics = await page.evaluate(() => {
    const vars = document.querySelectorAll('.journal-variables-container .game-variable--topbar');
    return Array.from(vars).map((v, i) => {
      const val = v.querySelector('.game-variable-value');
      const cap = v.querySelector('.game-variable-caption');
      const img = v.querySelector('.game-variable-image');
      return {
        index: i,
        value: val ? val.textContent : null,
        caption: cap ? cap.textContent : null,
        imageDisplay: img ? window.getComputedStyle(img).display : null,
        varDisplay: window.getComputedStyle(v).display,
        varRect: v.getBoundingClientRect(),
      };
    });
  });
  console.log('Metrics:', JSON.stringify(metrics, null, 2));

  await browser.close();
})();
