const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

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

  const html = await page.evaluate(() => {
    const screen = document.querySelector('.s1-screen');
    return screen ? screen.outerHTML.slice(0, 2000) : 'not found';
  });
  console.log(html);

  const classes = await page.evaluate(() => {
    const cards = document.querySelectorAll('.s1-card, .game-card');
    return Array.from(cards).slice(0, 8).map(c => Array.from(c.classList));
  });
  console.log('Card classes:', classes);

  await browser.close();
})();
