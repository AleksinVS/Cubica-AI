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
  console.log('Opening journal...');
  await (await page.$('#btn-journal')).click();
  await page.waitForTimeout(2000);
  console.log('Journal open:', !!(await page.$('.journal-screen')));

  // Click outside journal container (on the background)
  console.log('Clicking outside journal container...');
  const screen = await page.$('.journal-screen');
  const box = await screen.boundingBox();
  // Click near the edge of the screen, outside the container
  await page.mouse.click(50, 50);
  await page.waitForTimeout(2000);
  console.log('Journal open after outside click:', !!(await page.$('.journal-screen')));

  // Re-open journal
  console.log('Re-opening journal...');
  await (await page.$('#btn-journal')).click();
  await page.waitForTimeout(2000);
  console.log('Journal open after re-open:', !!(await page.$('.journal-screen')));

  await browser.close();
})();
