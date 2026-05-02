const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const DRAFT_URL = 'http://localhost:4000';
const TARGET_URL = 'http://localhost:3009';
const TARGET_API = 'http://localhost:3009/api/runtime';

async function createSession() {
  const res = await fetch(`${TARGET_API}/sessions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gameId: 'antarctica', playerId: 'player-web' })
  });
  const data = await res.json();
  return data.sessionId;
}

async function dispatchAction(sessionId, actionId) {
  await fetch(`${TARGET_API}/actions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, playerId: 'player-web', actionId })
  });
}

(async () => {
  const { spawn } = require('child_process');
  const draftProcess = spawn('npx', ['next', 'dev', '-p', '4000'], {
    cwd: path.join(__dirname, 'game-player-nextjs'),
    env: { ...process.env, NEXT_PUBLIC_DRAFT_SCREEN: 'leftsidebar' },
    stdio: 'ignore'
  });
  await new Promise(r => setTimeout(r, 8000));

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(`${DRAFT_URL}?local=true`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  const sessionId = await createSession();
  await dispatchAction(sessionId, 'showScreenWithLeftSideBar');

  await page.goto(TARGET_URL, { waitUntil: 'networkidle' });
  await page.evaluate((sid) => localStorage.setItem('cubica-antarctica-session-id', sid), sessionId);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  const html = await page.content();
  fs.writeFileSync('/tmp/target-vd-html.html', html);
  const classes = html.match(/class="[^"]*(leftsidebar-screen|info-screen|topbar-screen|journal-screen|hint-screen)[^"]*"/g);
  console.log('Target screen classes:', classes ? classes.slice(0, 5) : 'none');

  await page.screenshot({ path: '/tmp/target-vd-screenshot.png', fullPage: false });

  draftProcess.kill();
  await browser.close();
})();
