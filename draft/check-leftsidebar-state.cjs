const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const res = await fetch('http://localhost:3009/api/runtime/sessions', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gameId: 'antarctica', playerId: 'player-web' })
  });
  const { sessionId } = await res.json();
  await fetch('http://localhost:3009/api/runtime/actions', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, playerId: 'player-web', actionId: 'showScreenWithLeftSideBar' })
  });

  // Poll state
  for (let i = 0; i < 5; i++) {
    await new Promise(r => setTimeout(r, 500));
    const stateRes = await fetch(`http://localhost:3009/api/runtime/sessions/${sessionId}/state?playerId=player-web`);
    const state = await stateRes.json();
    console.log(`Poll ${i}: activeScreen=${state.activeScreen}, currentInfoId=${state.currentInfoId}, currentBoardId=${state.currentBoardId}, layoutMode=${state.layoutMode}`);
  }

  await browser.close();
})();
