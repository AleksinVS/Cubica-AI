const { chromium } = require('playwright');

(async () => {
  const res = await fetch('http://localhost:3009/api/runtime/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gameId: 'antarctica', playerId: 'player-web' })
  });
  const data = await res.json();

  // Advance past intro
  await fetch('http://localhost:3009/api/runtime/actions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: data.sessionId, playerId: 'player-web', actionId: 'advanceIntro' })
  });

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('http://localhost:3009', { waitUntil: 'networkidle' });
  await page.evaluate((sid) => {
    localStorage.setItem('cubica-antarctica-session-id', sid);
  }, data.sessionId);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(5000);

  console.log('Clicking journal on topbar info screen...');
  await page.click('#btn-journal');
  await page.waitForTimeout(3000);
  const journalVisible = await page.evaluate(() => !!document.querySelector('.journal-screen'));
  console.log('Journal visible:', journalVisible);

  console.log('Clicking hint from journal...');
  await page.click('#btn-hint');
  await page.waitForTimeout(3000);
  const hintVisible = await page.evaluate(() => !!document.querySelector('.antarctica-hint-screen'));
  console.log('Hint visible:', hintVisible);

  console.log('Clicking journal from hint...');
  await page.click('#btn-journal');
  await page.waitForTimeout(3000);
  const journalVisible2 = await page.evaluate(() => !!document.querySelector('.journal-screen'));
  console.log('Journal visible:', journalVisible2);

  // Close journal by button
  console.log('Closing journal by button...');
  await page.click('#btn-journal');
  await page.waitForTimeout(2000);
  const journalClosed = await page.evaluate(() => !!document.querySelector('.journal-screen'));
  console.log('Journal visible after close:', journalClosed);

  await browser.close();
})();
