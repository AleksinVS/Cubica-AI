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
    body: JSON.stringify({ sessionId, playerId: 'player-web', actionId: 'showScreenWithLeftSideBar' })
  });

  await page.goto('http://localhost:3009', { waitUntil: 'networkidle' });
  await page.evaluate((sid) => localStorage.setItem('cubica-antarctica-session-id', sid), sessionId);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  const html = await page.content();
  const classes = html.match(/class="[^"]*(leftsidebar-screen|info-screen|topbar-screen|journal-screen|hint-screen)[^"]*"/g);
  console.log('Screen classes found:', classes ? classes.slice(0, 5) : 'none');

  const title = await page.title();
  console.log('Page title:', title);

  // Check for info screen text
  const infoText = await page.$eval('.info-event-text', el => el.textContent.substring(0, 200)).catch(() => 'no info text');
  console.log('Info text:', infoText);

  await browser.close();
})();
