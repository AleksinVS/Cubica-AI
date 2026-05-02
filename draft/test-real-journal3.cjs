const { chromium } = require('playwright');

(async () => {
  const res = await fetch('http://localhost:3009/api/runtime/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gameId: 'antarctica', playerId: 'player-web' })
  });
  const data = await res.json();
  const sessionId = data.sessionId;

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('http://localhost:3009', { waitUntil: 'networkidle' });
  await page.evaluate((sid) => {
    localStorage.setItem('cubica-antarctica-session-id', sid);
  }, sessionId);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);

  // Click "Продолжить" repeatedly until we reach board screen
  for (let i = 0; i < 15; i++) {
    const screenClass = await page.evaluate(() => {
      const s = document.querySelector('.topbar-screen-shell, .info-screen-shell');
      return s?.className || 'none';
    });
    console.log(`Step ${i}: ${screenClass}`);

    if (screenClass.includes('topbar-screen-shell')) {
      console.log('Reached board screen!');
      await page.screenshot({ path: '/home/abc/projects/Cubica-AI/draft/real-board.png' });
      break;
    }

    const continueBtn = await page.$('button:has-text("Продолжить"), button:has-text("Далее")');
    if (continueBtn) {
      await continueBtn.click();
      await page.waitForTimeout(2000);
    } else {
      console.log('No continue button found');
      break;
    }
  }

  // Now try to click journal button
  const journalBtn = await page.$('#btn-journal');
  if (journalBtn) {
    await journalBtn.click();
    await page.waitForTimeout(3000);
    await page.screenshot({ path: '/home/abc/projects/Cubica-AI/draft/real-journal-manual.png' });
    console.log('Journal opened from board screen');

    const domCheck = await page.evaluate(() => {
      const screen = document.querySelector('.journal-screen');
      if (!screen) return { error: 'No journal screen' };
      return {
        hasJournalMetricCluster: !!screen.querySelector('.journal-variable-component'),
        containerCount: screen.querySelectorAll('.journal-container').length,
        buttonCount: screen.querySelectorAll('.button-container button').length,
        arrowCount: screen.querySelectorAll('#nav-left, #nav-right').length,
      };
    });
    console.log('DOM check:', JSON.stringify(domCheck));
  } else {
    console.log('No journal button on board screen');
    await page.screenshot({ path: '/home/abc/projects/Cubica-AI/draft/real-no-journal-btn.png' });
  }

  await browser.close();
})();
