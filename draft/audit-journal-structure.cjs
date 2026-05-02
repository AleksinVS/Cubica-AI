const { chromium } = require('playwright');

async function auditDraft() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('http://localhost:4000?local=true&screen=journal', { waitUntil: 'networkidle' });
  await page.waitForTimeout(4000);

  const info = await page.evaluate(() => {
    const screen = document.querySelector('.default-main-screen, .main-screen');
    if (!screen) return { error: 'No screen found', html: document.body.innerHTML.slice(0, 500) };

    const addBg = screen.querySelector('.additional-background');
    const children = addBg ? Array.from(addBg.children) : [];

    return {
      screenClass: screen.className,
      addBgExists: !!addBg,
      childCount: children.length,
      children: children.map(c => ({
        tag: c.tagName,
        className: c.className,
        rect: c.getBoundingClientRect(),
        childCount: c.children.length,
        grandChildren: Array.from(c.children).map(g => ({
          tag: g.tagName,
          className: g.className,
          text: g.textContent?.trim().slice(0, 60),
          rect: g.getBoundingClientRect(),
        })),
      })),
    };
  });

  await browser.close();
  return info;
}

async function auditTarget() {
  const res = await fetch('http://localhost:3009/api/runtime/sessions', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gameId: 'antarctica', playerId: 'player-web' })
  });
  const data = await res.json();
  const sessionId = data.sessionId;
  await fetch('http://localhost:3009/api/runtime/actions', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, playerId: 'player-web', actionId: 'showHistory' })
  });

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('http://localhost:3009', { waitUntil: 'networkidle' });
  await page.evaluate((sid) => { localStorage.setItem('cubica-antarctica-session-id', sid); }, sessionId);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(4000);

  const info = await page.evaluate(() => {
    const screen = document.querySelector('.journal-screen');
    if (!screen) return { error: 'No journal-screen found', screens: Array.from(document.querySelectorAll('[class*="screen"]')).map(s => s.className) };

    const mainContent = screen.querySelector('.journal-main-content');
    const children = mainContent ? Array.from(mainContent.children) : [];

    return {
      screenClass: screen.className,
      mainContentClass: mainContent?.className,
      childCount: children.length,
      children: children.map(c => ({
        tag: c.tagName,
        className: c.className,
        rect: c.getBoundingClientRect(),
        childCount: c.children.length,
        grandChildren: Array.from(c.children).map(g => ({
          tag: g.tagName,
          className: g.className,
          text: g.textContent?.trim().slice(0, 60),
          rect: g.getBoundingClientRect(),
        })),
      })),
    };
  });

  await browser.close();
  return info;
}

(async () => {
  const draft = await auditDraft();
  const target = await auditTarget();
  console.log('=== DRAFT ===');
  console.log(JSON.stringify(draft, null, 2));
  console.log('=== TARGET ===');
  console.log(JSON.stringify(target, null, 2));
})();
