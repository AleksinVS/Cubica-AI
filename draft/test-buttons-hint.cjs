const { chromium } = require('playwright');

(async () => {
  const res = await fetch('http://localhost:3009/api/runtime/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gameId: 'antarctica', playerId: 'player-web' })
  });
  const data = await res.json();

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

  // Open hint first
  await page.click('#btn-hint');
  await page.waitForTimeout(2000);

  const info = await page.evaluate(() => {
    const getInfo = (el) => ({
      tag: el.tagName,
      className: el.className,
      id: el.id,
      rect: el.getBoundingClientRect(),
      zIndex: window.getComputedStyle(el).zIndex,
      position: window.getComputedStyle(el).position,
      pointerEvents: window.getComputedStyle(el).pointerEvents,
    });

    const getTopElement = (el) => {
      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const topEl = document.elementFromPoint(cx, cy);
      return topEl ? getInfo(topEl) : null;
    };

    const btnJournal = document.getElementById('btn-journal');
    const btnHint = document.getElementById('btn-hint');
    const screen = document.querySelector('.antarctica-hint-screen');

    return {
      screen: screen ? getInfo(screen) : null,
      btnJournal: btnJournal ? getInfo(btnJournal) : null,
      btnHint: btnHint ? getInfo(btnHint) : null,
      topAtJournal: btnJournal ? getTopElement(btnJournal) : null,
      topAtHint: btnHint ? getTopElement(btnHint) : null,
    };
  });

  console.log(JSON.stringify(info, null, 2));

  // Try clicking journal from hint
  console.log('\nTrying to click journal button from hint...');
  try {
    await page.click('#btn-journal');
    console.log('Journal click succeeded');
  } catch (e) {
    console.log('Journal click failed:', e.message);
  }

  await page.waitForTimeout(2000);
  const journalVisible = await page.evaluate(() => !!document.querySelector('.journal-screen'));
  console.log('Journal visible after click:', journalVisible);

  await browser.close();
})();
