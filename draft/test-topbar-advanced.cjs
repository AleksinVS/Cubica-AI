const { chromium } = require('playwright');

(async () => {
  const res = await fetch('http://localhost:3009/api/runtime/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gameId: 'antarctica', playerId: 'player-web' })
  });
  const data = await res.json();

  // Advance past intro
  await fetch('http://localhost:3009/api/runtime/actions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: data.sessionId, playerId: 'player-web', actionId: 'advanceIntro' })
  });

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('http://localhost:3009', { waitUntil: 'networkidle' });
  await page.evaluate((sid) => {
    localStorage.setItem('cubica-antarctica-session-id', sid);
  }, data.sessionId);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(5000);

  const info = await page.evaluate(() => {
    return {
      screen: document.querySelector('.topbar-screen-shell, .leftsidebar-screen')?.className,
      buttons: Array.from(document.querySelectorAll('button')).map(b => ({
        id: b.id,
        className: b.className,
        text: b.textContent.trim(),
        disabled: b.disabled,
      })),
    };
  });
  console.log('After advance - Screen info:', JSON.stringify(info, null, 2));

  if (info.buttons.some(b => b.id === 'btn-journal')) {
    console.log('\nClicking journal on topbar...');
    await page.click('#btn-journal');
    await page.waitForTimeout(3000);
    const journalVisible = await page.evaluate(() => !!document.querySelector('.journal-screen'));
    console.log('Journal visible:', journalVisible);
  } else {
    console.log('Journal button NOT found on topbar after advance');
  }

  await browser.close();
})();
