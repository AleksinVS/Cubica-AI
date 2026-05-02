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

  // Open hint
  console.log('Opening hint...');
  await (await page.$('#btn-hint')).click();
  await page.waitForTimeout(2000);
  console.log('Hint open:', !!(await page.$('.antarctica-hint-screen')));

  // Close hint by clicking hint button inside
  console.log('Closing hint by button...');
  await (await page.$('#btn-hint')).click();
  await page.waitForTimeout(2000);
  console.log('Hint open after button close:', !!(await page.$('.antarctica-hint-screen')));

  // Re-open hint
  console.log('Re-opening hint...');
  await (await page.$('#btn-hint')).click();
  await page.waitForTimeout(2000);
  console.log('Hint open after re-open:', !!(await page.$('.antarctica-hint-screen')));

  // Close hint by clicking outside
  console.log('Closing hint by outside click...');
  await page.mouse.click(50, 50);
  await page.waitForTimeout(2000);
  console.log('Hint open after outside click:', !!(await page.$('.antarctica-hint-screen')));

  // Re-open hint
  console.log('Re-opening hint again...');
  await (await page.$('#btn-hint')).click();
  await page.waitForTimeout(2000);
  console.log('Hint open after second re-open:', !!(await page.$('.antarctica-hint-screen')));

  await browser.close();
})();
