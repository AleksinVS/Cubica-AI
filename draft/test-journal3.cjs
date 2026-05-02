const { chromium } = require('playwright');

(async () => {
  const res = await fetch('http://localhost:3009/api/runtime/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gameId: 'antarctica', playerId: 'player-web' })
  });
  const data = await res.json();

  // Advance to leftsidebar so panel buttons are visible
  await fetch('http://localhost:3009/api/runtime/actions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: data.sessionId, playerId: 'player-web', actionId: 'showScreenWithLeftSideBar' })
  });

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('http://localhost:3009', { waitUntil: 'networkidle' });
  await page.evaluate((sid) => {
    localStorage.setItem('cubica-antarctica-session-id', sid);
  }, data.sessionId);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);

  const buttonsBefore = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('button')).map(b => ({
      id: b.id,
      className: b.className,
      text: b.textContent.trim()
    }));
  });
  console.log('Buttons before open:', JSON.stringify(buttonsBefore, null, 2));

  // Click journal button
  const journalBtn = await page.$('#btn-journal');
  if (journalBtn) {
    console.log('Journal button found, clicking...');
    await journalBtn.click();
    await page.waitForTimeout(3000);

    const journalScreen = await page.$('.journal-screen');
    console.log('Journal screen visible after open:', !!journalScreen);

    if (journalScreen) {
      // Click journal button again (inside journal)
      const journalBtn2 = await page.$('#btn-journal');
      if (journalBtn2) {
        console.log('Journal button inside journal found, clicking...');
        await journalBtn2.click();
        await page.waitForTimeout(3000);

        const journalScreen2 = await page.$('.journal-screen');
        console.log('Journal screen visible after close:', !!journalScreen2);
      }
    }
  } else {
    console.log('Journal button NOT found');
  }

  await browser.close();
})();
