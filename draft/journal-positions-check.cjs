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

  const positions = await page.evaluate(() => {
    const containers = document.querySelectorAll('.journal-container');
    const cards = document.querySelectorAll('.journal-entry-card');
    const vars = document.querySelectorAll('.journal-variables-container');
    return {
      containers: Array.from(containers).map(c => c.getBoundingClientRect()),
      cards: Array.from(cards).map(c => c.getBoundingClientRect()),
      varContainers: Array.from(vars).map(v => v.getBoundingClientRect()),
    };
  });
  console.log(JSON.stringify(positions, null, 2));

  await browser.close();
})();
