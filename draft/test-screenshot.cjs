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

  // Screenshot leftsidebar with buttons highlighted
  await page.evaluate(() => {
    document.querySelectorAll('#btn-journal, #btn-hint, #nav-left, #nav-right').forEach((b) => {
      b.style.outline = '4px solid red';
      b.style.zIndex = '9999';
    });
  });
  await page.screenshot({ path: '/tmp/leftsidebar-buttons.png' });

  // Open hint
  await page.click('#btn-hint');
  await page.waitForTimeout(2000);
  await page.evaluate(() => {
    document.querySelectorAll('#btn-journal, #btn-hint, #nav-left, #nav-right').forEach((b) => {
      b.style.outline = '4px solid red';
      b.style.zIndex = '9999';
    });
  });
  await page.screenshot({ path: '/tmp/hint-buttons.png' });

  // Open journal
  await page.click('#btn-journal');
  await page.waitForTimeout(2000);
  await page.evaluate(() => {
    document.querySelectorAll('#btn-journal, #btn-hint, #nav-left, #nav-right').forEach((b) => {
      b.style.outline = '4px solid red';
      b.style.zIndex = '9999';
    });
  });
  await page.screenshot({ path: '/tmp/journal-buttons.png' });

  console.log('Screenshots saved');
  await browser.close();
})();
