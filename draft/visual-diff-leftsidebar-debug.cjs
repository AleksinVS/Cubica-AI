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
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Visit draft first
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(`${DRAFT_URL}?local=true`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  console.log('Draft page loaded');

  const sessionId = await createSession();
  await dispatchAction(sessionId, 'showScreenWithLeftSideBar');

  // Visit target
  await page.goto(TARGET_URL, { waitUntil: 'networkidle' });
  await page.evaluate((sid) => localStorage.setItem('cubica-antarctica-session-id', sid), sessionId);
  await page.reload({ waitUntil: 'networkidle' });
  try {
    await page.waitForSelector('.leftsidebar-screen', { timeout: 10000 });
    console.log('Target leftsidebar found');
  } catch {
    console.warn('Target leftsidebar NOT found');
  }
  await page.waitForTimeout(1000);

  const html = await page.content();
  const classes = html.match(/class="[^"]*(leftsidebar-screen|info-screen|topbar-screen|journal-screen|hint-screen)[^"]*"/g);
  console.log('Target screen classes:', classes ? classes.slice(0, 5) : 'none');

  const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 300));
  console.log('Target body text:', bodyText);

  await page.screenshot({ path: '/tmp/target-vd-debug.png', fullPage: false });
  console.log('Screenshot saved to /tmp/target-vd-debug.png');

  await browser.close();
})();
