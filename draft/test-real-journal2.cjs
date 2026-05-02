const { chromium } = require('playwright');

async function dispatchAction(sessionId, actionId) {
  await fetch('http://localhost:3009/api/runtime/actions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, playerId: 'player-web', actionId })
  });
}

(async () => {
  const res = await fetch('http://localhost:3009/api/runtime/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gameId: 'antarctica', playerId: 'player-web' })
  });
  const data = await res.json();
  const sessionId = data.sessionId;
  console.log('Session:', sessionId);

  // Advance through intro screens via API
  const actions = ['advanceIntro', 'advanceIntro', 'advanceIntro', 'advanceIntro', 'advanceIntro', 'advanceIntro', 'advanceIntro', 'advanceIntro'];
  for (const a of actions) {
    await dispatchAction(sessionId, a);
    await new Promise(r => setTimeout(r, 500));
  }

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('http://localhost:3009', { waitUntil: 'networkidle' });
  await page.evaluate((sid) => {
    localStorage.setItem('cubica-antarctica-session-id', sid);
  }, sessionId);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);

  // Check screen
  const screenInfo = await page.evaluate(() => {
    const s = document.querySelector('.topbar-screen-shell, .info-screen-shell, .journal-screen, .leftsidebar-screen');
    return s ? { className: s.className } : { error: 'No screen found', bodyClasses: document.body.className };
  });
  console.log('Screen after advance:', JSON.stringify(screenInfo));
  await page.screenshot({ path: '/home/abc/projects/Cubica-AI/draft/real-board-screen.png' });

  // Find and click journal button
  const journalBtn = await page.$('#btn-journal, button:has-text("журнал"), button:has-text("Журнал")');
  if (journalBtn) {
    await journalBtn.click();
    await page.waitForTimeout(3000);
    await page.screenshot({ path: '/home/abc/projects/Cubica-AI/draft/real-journal-from-board.png' });
    console.log('Journal screenshot saved');
  } else {
    console.log('No journal button found');
    // Print all buttons
    const btns = await page.evaluate(() => Array.from(document.querySelectorAll('button')).map(b => ({
      id: b.id, className: b.className, text: b.textContent?.trim().slice(0, 30)
    })));
    console.log('All buttons:', JSON.stringify(btns));
  }

  // Verify journal DOM matches our changes
  const journalDom = await page.evaluate(() => {
    const screen = document.querySelector('.journal-screen');
    if (!screen) return { error: 'No journal' };
    return {
      hasJournalMetricCluster: !!screen.querySelector('.journal-variable-component'),
      hasTwoContainers: screen.querySelectorAll('.journal-container').length === 2,
      buttonCount: screen.querySelectorAll('.button-container button').length,
      arrowButtonCount: screen.querySelectorAll('#nav-left, #nav-right').length,
    };
  });
  console.log('Journal DOM check:', JSON.stringify(journalDom));

  await browser.close();
})();
