const { chromium } = require('playwright');

const TARGET_URL = 'http://localhost:3009';
const TARGET_API = 'http://localhost:3009/api/runtime';

async function createSession() {
  const res = await fetch(`${TARGET_API}/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gameId: 'antarctica', playerId: 'player-web' })
  });
  const data = await res.json();
  return data.sessionId;
}

async function dispatchAction(sessionId, actionId) {
  await fetch(`${TARGET_API}/actions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, playerId: 'player-web', actionId })
  });
}

(async () => {
  const sessionId = await createSession();
  await dispatchAction(sessionId, 'showScreenWithLeftSideBar');

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1920, height: 1080 });

  await page.goto(`${TARGET_URL}?local=true`, { waitUntil: 'networkidle' });
  await page.evaluate((sid) => localStorage.setItem('cubica-antarctica-session-id', sid), sessionId);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  // Check what's on the page
  const html = await page.content();
  const classes = html.match(/class="[^"]*(leftsidebar-screen|info-screen|topbar-screen|journal-screen|hint-screen)[^"]*"/g);
  console.log('Screen classes found:', classes ? classes.slice(0, 5) : 'none');

  // Find first visible screen-like element
  const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 300));
  console.log('Body text start:', bodyText);

  await page.screenshot({ path: '/tmp/target-debug.png', fullPage: false });
  console.log('Screenshot saved to /tmp/target-debug.png');

  await browser.close();
})();
