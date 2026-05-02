const { chromium } = require('playwright');

(async () => {
  const res = await fetch('http://localhost:3009/api/runtime/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gameId: 'antarctica', playerId: 'player-web' })
  });
  const data = await res.json();

  await fetch('http://localhost:3009/api/runtime/actions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: data.sessionId, playerId: 'player-web', actionId: 'showScreenWithLeftSideBar' })
  });

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('http://localhost:3009', { waitUntil: 'networkidle' });
  await page.evaluate((sid) => {
    localStorage.setItem('cubica-antarctica-session-id', sid);
  }, data.sessionId);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);

  // Open journal
  await page.click('#btn-journal');
  await page.waitForTimeout(1000);
  const journalOpen = await page.evaluate(() => !!document.querySelector('.journal-screen'));
  console.log('Journal open:', journalOpen);

  // Click journal button inside journal (should close)
  await page.click('#btn-journal');
  await page.waitForTimeout(1000);
  const journalAfterClose = await page.evaluate(() => !!document.querySelector('.journal-screen'));
  console.log('Journal after button close:', journalAfterClose);

  // Re-open journal
  await page.click('#btn-journal');
  await page.waitForTimeout(1000);
  const journalReopen = await page.evaluate(() => !!document.querySelector('.journal-screen'));
  console.log('Journal re-open:', journalReopen);

  // Open hint from journal
  await page.click('#btn-hint');
  await page.waitForTimeout(1000);
  const hintOpen = await page.evaluate(() => !!document.querySelector('.antarctica-hint-screen'));
  console.log('Hint open from journal:', hintOpen);

  // Close hint by button
  await page.click('#btn-hint');
  await page.waitForTimeout(1000);
  const hintAfterClose = await page.evaluate(() => !!document.querySelector('.antarctica-hint-screen'));
  console.log('Hint after button close:', hintAfterClose);

  // Open hint again
  await page.click('#btn-hint');
  await page.waitForTimeout(1000);
  const hintReopen = await page.evaluate(() => !!document.querySelector('.antarctica-hint-screen'));
  console.log('Hint re-open:', hintReopen);

  // Open journal from hint
  await page.click('#btn-journal');
  await page.waitForTimeout(1000);
  const journalFromHint = await page.evaluate(() => !!document.querySelector('.journal-screen'));
  console.log('Journal open from hint:', journalFromHint);

  await browser.close();
})();
