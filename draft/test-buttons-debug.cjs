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

  // Get computed styles for buttons
  const info = await page.evaluate(() => {
    const btnJournal = document.getElementById('btn-journal');
    const btnHint = document.getElementById('btn-hint');
    
    const getStyles = (el) => {
      if (!el) return null;
      const cs = window.getComputedStyle(el);
      return {
        opacity: cs.opacity,
        pointerEvents: cs.pointerEvents,
        display: cs.display,
        visibility: cs.visibility,
        disabled: el.disabled,
        offsetWidth: el.offsetWidth,
        offsetHeight: el.offsetHeight,
        clientWidth: el.clientWidth,
        clientHeight: el.clientHeight,
      };
    };
    
    const getParentChain = (el) => {
      const chain = [];
      let curr = el;
      while (curr && curr !== document.body) {
        const cs = window.getComputedStyle(curr);
        chain.push({
          tag: curr.tagName,
          className: curr.className,
          pointerEvents: cs.pointerEvents,
          opacity: cs.opacity,
          display: cs.display,
          visibility: cs.visibility,
        });
        curr = curr.parentElement;
      }
      return chain;
    };
    
    return {
      journalBtn: getStyles(btnJournal),
      hintBtn: getStyles(btnHint),
      journalParentChain: getParentChain(btnJournal),
      hintParentChain: getParentChain(btnHint),
    };
  });

  console.log(JSON.stringify(info, null, 2));

  // Try clicking
  console.log('\nTrying clicks...');
  try {
    await page.click('#btn-journal');
    console.log('Journal click: success');
  } catch (e) {
    console.log('Journal click: failed -', e.message);
  }
  
  await page.waitForTimeout(1000);
  
  const journalVisible = await page.evaluate(() => !!document.querySelector('.journal-screen'));
  console.log('Journal visible:', journalVisible);

  await browser.close();
})();
