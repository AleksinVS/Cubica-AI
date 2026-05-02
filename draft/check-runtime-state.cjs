const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const res = await fetch('http://localhost:3009/api/runtime/sessions', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gameId: 'antarctica', playerId: 'player-web' })
  });
  const { sessionId } = await res.json();

  // Get initial state
  await page.goto(`http://localhost:3009/api/runtime/sessions/${sessionId}/state?playerId=player-web`, { waitUntil: 'networkidle' });
  const initialState = await page.evaluate(() => JSON.parse(document.body.innerText));
  console.log('Initial state keys:', Object.keys(initialState));
  console.log('currentScreenId:', initialState.currentScreenId);
  console.log('currentInfoId:', initialState.currentInfoId);
  console.log('activeScreen:', initialState.activeScreen);
  console.log('activePanel:', initialState.activePanel);

  await fetch('http://localhost:3009/api/runtime/actions', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, playerId: 'player-web', actionId: 'showScreenWithLeftSideBar' })
  });

  await page.goto(`http://localhost:3009/api/runtime/sessions/${sessionId}/state?playerId=player-web`, { waitUntil: 'networkidle' });
  const afterState = await page.evaluate(() => JSON.parse(document.body.innerText));
  console.log('\nAfter action state keys:', Object.keys(afterState));
  console.log('currentScreenId:', afterState.currentScreenId);
  console.log('currentInfoId:', afterState.currentInfoId);
  console.log('activeScreen:', afterState.activeScreen);
  console.log('activePanel:', afterState.activePanel);

  await browser.close();
})();
