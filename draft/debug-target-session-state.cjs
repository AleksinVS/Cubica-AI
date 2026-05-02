const { chromium } = require('playwright');

(async () => {
  const res = await fetch('http://localhost:3009/api/runtime/sessions', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gameId: 'antarctica', playerId: 'player-web' })
  });
  const { sessionId } = await res.json();
  console.log('Session ID:', sessionId);

  await fetch('http://localhost:3009/api/runtime/actions', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, playerId: 'player-web', actionId: 'showScreenWithLeftSideBar' })
  });

  // Get session state
  const stateRes = await fetch(`http://localhost:3009/api/runtime/sessions/${sessionId}`);
  const state = await stateRes.json();
  console.log('Active screen:', state?.ui?.activeScreen);
  console.log('Active panel:', state?.ui?.activePanel);
  console.log('Current info:', state?.ui?.currentInfo);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('http://localhost:3009', { waitUntil: 'networkidle' });
  await page.evaluate((sid) => localStorage.setItem('cubica-antarctica-session-id', sid), sessionId);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  const html = await page.content();
  const classes = html.match(/class="[^"]*(leftsidebar-screen|info-screen|topbar-screen|journal-screen|hint-screen)[^"]*"/g);
  console.log('Screen classes found:', classes ? classes.slice(0, 5) : 'none');

  await browser.close();
})();
