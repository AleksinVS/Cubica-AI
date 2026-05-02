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

  const hasInfo = await page.evaluate(() => !!document.querySelector('.info-event-card'));
  const hasFallback = await page.evaluate(() => !!document.querySelector('.antarctica-action-cards-container'));
  const cards = await page.evaluate(() => document.querySelectorAll('.s1-card').length);
  const fallbackCards = await page.evaluate(() => document.querySelectorAll('.antarctica-fallback-card').length);
  console.log('Has info card:', hasInfo);
  console.log('Has fallback container:', hasFallback);
  console.log('Total .s1-card count:', cards);
  console.log('Fallback cards:', fallbackCards);

  await browser.close();
})();
