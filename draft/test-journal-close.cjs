const { chromium } = require('playwright');

(async () => {
  const res = await fetch('http://localhost:3009/api/runtime/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gameId: 'antarctica', playerId: 'player-web' })
  });
  const data = await res.json();
  const sessionId = data.sessionId;
  await fetch('http://localhost:3009/api/runtime/actions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, playerId: 'player-web', actionId: 'showHistory' })
  });

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('http://localhost:3009', { waitUntil: 'networkidle' });
  await page.evaluate((sid) => {
    localStorage.setItem('cubica-antarctica-session-id', sid);
  }, sessionId);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);

  // Check journal is open
  const hasJournal = await page.evaluate(() => !!document.querySelector('.journal-screen'));
  console.log('Journal open before click:', hasJournal);

  // Click outside the journal container
  await page.click('.journal-screen', { position: { x: 50, y: 50 } });
  await page.waitForTimeout(1000);

  // Check journal is closed
  const hasJournalAfter = await page.evaluate(() => !!document.querySelector('.journal-screen'));
  console.log('Journal open after click:', hasJournalAfter);
  console.log(hasJournal && !hasJournalAfter ? '✅ Journal closes on outside click' : '❌ Journal did not close');

  await browser.close();
})();
