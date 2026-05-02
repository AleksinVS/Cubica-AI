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

  // Open journal and close by clicking outside
  await page.click('#btn-journal');
  await page.waitForTimeout(1000);
  console.log('Journal open:', await page.evaluate(() => !!document.querySelector('.journal-screen')));

  // Click outside (left edge)
  await page.mouse.click(50, 540);
  await page.waitForTimeout(1000);
  console.log('Journal after outside click:', await page.evaluate(() => !!document.querySelector('.journal-screen')));

  // Open hint and close by clicking outside
  await page.click('#btn-hint');
  await page.waitForTimeout(1000);
  console.log('Hint open:', await page.evaluate(() => !!document.querySelector('.antarctica-hint-screen')));

  // Click outside (left edge)
  await page.mouse.click(50, 540);
  await page.waitForTimeout(1000);
  console.log('Hint after outside click:', await page.evaluate(() => !!document.querySelector('.antarctica-hint-screen')));

  await browser.close();
})();
