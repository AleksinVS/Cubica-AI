const { chromium } = require('playwright');

async function inspectTarget() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1920, height: 1080 });

  const res = await fetch('http://localhost:3009/api/runtime/sessions', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gameId: 'antarctica', playerId: 'player-web' })
  });
  const { sessionId } = await res.json();
  await fetch('http://localhost:3009/api/runtime/actions', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, playerId: 'player-web', actionId: 'showScreenWithLeftSideBar' })
  });

  await page.goto('http://localhost:3009', { waitUntil: 'networkidle' });
  await page.evaluate((sid) => localStorage.setItem('cubica-antarctica-session-id', sid), sessionId);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  const selectors = [
    '.leftsidebar-screen',
    '.leftsidebar-screen .game-variables-container',
    '.leftsidebar-screen .game-variable--score',
    '.leftsidebar-screen .game-variable:nth-child(2)',
    '.leftsidebar-screen .cards-container',
    '.leftsidebar-screen .cards-container > .s1-card:first-child',
    '.leftsidebar-screen .bottom-controls-container',
    '.leftsidebar-screen .bottom-controls-container #btn-journal',
    '.leftsidebar-screen .bottom-controls-container #nav-left',
  ];

  console.log('=== TARGET ===');
  for (const sel of selectors) {
    const el = await page.$(sel);
    if (!el) {
      console.log(`${sel}: NOT FOUND`);
      continue;
    }
    const styles = await el.evaluate((node) => {
      const cs = window.getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return {
        sel: node.className || node.id,
        display: cs.display,
        width: cs.width,
        height: cs.height,
        top: rect.top,
        left: rect.left,
        backgroundColor: cs.backgroundColor,
        color: cs.color,
        fontSize: cs.fontSize,
        fontFamily: cs.fontFamily,
        lineHeight: cs.lineHeight,
        padding: cs.padding,
        margin: cs.margin,
        borderRadius: cs.borderRadius,
        gridTemplateColumns: cs.gridTemplateColumns,
        gridTemplateRows: cs.gridTemplateRows,
        gridColumn: cs.gridColumn,
        gridRow: cs.gridRow,
        position: cs.position,
        zIndex: cs.zIndex,
      };
    });
    console.log(JSON.stringify(styles));
  }

  await browser.close();
}

async function inspectDraft() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1920, height: 1080 });

  await page.goto('http://localhost:4000?fixture=screen_leftsidebar', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  const selectors = [
    '.leftsidebar-screen',
    '.leftsidebar-screen .sidebar',
    '.leftsidebar-screen .sidebar .game-variable:first-child',
    '.leftsidebar-screen .sidebar .game-variable:nth-child(2)',
    '.leftsidebar-screen .cards-container',
    '.leftsidebar-screen .cards-container > .game-card:first-child',
    '.leftsidebar-screen .footer',
    '.leftsidebar-screen .footer #btn-journal',
    '.leftsidebar-screen .footer #nav-left',
  ];

  console.log('=== DRAFT ===');
  for (const sel of selectors) {
    const el = await page.$(sel);
    if (!el) {
      console.log(`${sel}: NOT FOUND`);
      continue;
    }
    const styles = await el.evaluate((node) => {
      const cs = window.getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return {
        sel: node.className || node.id,
        display: cs.display,
        width: cs.width,
        height: cs.height,
        top: rect.top,
        left: rect.left,
        backgroundColor: cs.backgroundColor,
        color: cs.color,
        fontSize: cs.fontSize,
        fontFamily: cs.fontFamily,
        lineHeight: cs.lineHeight,
        padding: cs.padding,
        margin: cs.margin,
        borderRadius: cs.borderRadius,
        gridTemplateColumns: cs.gridTemplateColumns,
        gridTemplateRows: cs.gridTemplateRows,
        gridColumn: cs.gridColumn,
        gridRow: cs.gridRow,
        position: cs.position,
        zIndex: cs.zIndex,
      };
    });
    console.log(JSON.stringify(styles));
  }

  await browser.close();
}

(async () => {
  await inspectDraft();
  await inspectTarget();
})();
