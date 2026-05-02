const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const DRAFT_URL = 'http://localhost:4000';
const TARGET_URL = 'http://localhost:3009';
const TARGET_API = 'http://localhost:3009/api/runtime';
const OUTPUT_DIR = path.join(__dirname, 'visual-diff-results');

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
  await page.screenshot({ path: path.join(OUTPUT_DIR, 'draft-test.png'), fullPage: false });

  const sessionId = await createSession();
  await dispatchAction(sessionId, 'showScreenWithLeftSideBar');

  await page.goto(TARGET_URL, { waitUntil: 'networkidle' });
  await page.evaluate((sid) => localStorage.setItem('cubica-antarctica-session-id', sid), sessionId);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(OUTPUT_DIR, 'target-test.png'), fullPage: false });

  // Analyze target screenshot: check if it has white text on blue background (leftsidebar) or other
  const targetImg = PNG.sync.read(fs.readFileSync(path.join(OUTPUT_DIR, 'target-test.png')));
  // Sample a pixel near the sidebar (50,100) and a pixel in the cards area (600,100)
  const idx1 = (100 * 1920 + 50) * 4;
  const idx2 = (100 * 1920 + 600) * 4;
  console.log('Sidebar pixel (50,100):', targetImg.data[idx1], targetImg.data[idx1+1], targetImg.data[idx1+2]);
  console.log('Cards pixel (600,100):', targetImg.data[idx2], targetImg.data[idx2+1], targetImg.data[idx2+2]);

  draftProcess.kill();
  await browser.close();
})();
