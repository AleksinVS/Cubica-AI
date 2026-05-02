const { chromium } = require('playwright');

(async () => {
  const res = await fetch('http://localhost:3009/api/runtime/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gameId: 'antarctica', playerId: 'player-web' })
  });
  const data = await res.json();
  console.log('Session:', data.sessionId);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('http://localhost:3009', { waitUntil: 'networkidle' });
  await page.evaluate((sid) => {
    localStorage.setItem('cubica-antarctica-session-id', sid);
  }, data.sessionId);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);

  // Click journal button
  const journalBtn = await page.$('#btn-journal');
  if (journalBtn) {
    console.log('Journal button found, clicking...');
    await journalBtn.click();
    await page.waitForTimeout(2000);

    const journalScreen = await page.$('.journal-screen');
    console.log('Journal screen visible after open:', !!journalScreen);

    if (journalScreen) {
      // Click journal button again (inside journal)
      const journalBtn2 = await page.$('#btn-journal');
      if (journalBtn2) {
        console.log('Journal button inside journal found, clicking...');
        await journalBtn2.click();
        await page.waitForTimeout(2000);

        const journalScreen2 = await page.$('.journal-screen');
        console.log('Journal screen visible after close:', !!journalScreen2);
      }
    }
  } else {
    console.log('Journal button NOT found');
  }

  await browser.close();
})();
