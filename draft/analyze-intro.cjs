const { chromium } = require('playwright');

(async () => {
  const res = await fetch('http://localhost:3009/api/runtime/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gameId: 'antarctica', playerId: 'player-web' })
  });
  const data = await res.json();

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('http://localhost:3009', { waitUntil: 'networkidle' });
  await page.evaluate((sid) => {
    localStorage.setItem('cubica-antarctica-session-id', sid);
  }, data.sessionId);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(5000);

  // Analyze what's at the button positions
  const info = await page.evaluate(() => {
    const btnJournal = document.getElementById('btn-journal');
    if (!btnJournal) return { error: 'btn-journal not found' };

    const rect = btnJournal.getBoundingClientRect();
    const points = [
      { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
      { x: rect.left + 5, y: rect.top + 5 },
      { x: rect.right - 5, y: rect.bottom - 5 },
    ];

    // Walk up the DOM tree to find the root shell
    let shell = document.querySelector('.topbar-screen-shell, .leftsidebar-screen, .info-screen-shell');
    let shellGrid = shell ? window.getComputedStyle(shell).display : 'none';
    let shellRows = shell ? window.getComputedStyle(shell).gridTemplateRows : 'none';

    return {
      shellClass: shell?.className,
      shellDisplay: shellGrid,
      shellRows: shellRows,
      points: points.map(p => {
        const el = document.elementFromPoint(p.x, p.y);
        return {
          x: p.x, y: p.y,
          topElement: el ? {
            tag: el.tagName,
            id: el.id,
            className: el.className,
          } : null,
          isBtnJournal: el === btnJournal || btnJournal.contains(el),
        };
      }),
      btnRect: {
        x: rect.x, y: rect.y,
        width: rect.width, height: rect.height,
        top: rect.top, right: rect.right,
        bottom: rect.bottom, left: rect.left
      },
      btnParentChain: [],
    };
  });

  console.log('Intro analysis:', JSON.stringify(info, null, 2));

  await browser.close();
})();
