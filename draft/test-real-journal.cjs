const { chromium } = require('playwright');

(async () => {
  const res = await fetch('http://localhost:3009/api/runtime/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gameId: 'antarctica', playerId: 'player-web' })
  });
  const data = await res.json();
  const sessionId = data.sessionId;
  console.log('Session:', sessionId);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('http://localhost:3009', { waitUntil: 'networkidle' });
  await page.evaluate((sid) => {
    localStorage.setItem('cubica-antarctica-session-id', sid);
  }, sessionId);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);

  // Take screenshot of initial state
  await page.screenshot({ path: '/home/abc/projects/Cubica-AI/draft/real-initial.png' });
  console.log('Initial screen saved');

  // Check what screen is visible
  const initialInfo = await page.evaluate(() => {
    const screen = document.querySelector('.topbar-screen-shell, .info-screen-shell, .journal-screen');
    return screen ? { className: screen.className, rect: screen.getBoundingClientRect() } : null;
  });
  console.log('Initial screen:', JSON.stringify(initialInfo));

  // Click "Далее" / continue button if present (to advance past intro)
  const continueBtn = await page.$('button:has-text("Далее"), button:has-text("Продолжить"), .info-bottom-controls button');
  if (continueBtn) {
    await continueBtn.click();
    await page.waitForTimeout(3000);
    await page.screenshot({ path: '/home/abc/projects/Cubica-AI/draft/real-after-continue.png' });
    console.log('After continue saved');
  }

  // Try to find and click journal button
  const journalBtn = await page.$('#btn-journal, button:has-text("журнал"), button:has-text("Журнал")');
  if (journalBtn) {
    await journalBtn.click();
    await page.waitForTimeout(3000);
    await page.screenshot({ path: '/home/abc/projects/Cubica-AI/draft/real-journal-opened.png' });
    console.log('Journal opened via button click saved');
  } else {
    console.log('No journal button found');
    await page.screenshot({ path: '/home/abc/projects/Cubica-AI/draft/real-no-journal-btn.png' });
  }

  // Check DOM info of journal
  const journalInfo = await page.evaluate(() => {
    const screen = document.querySelector('.journal-screen');
    if (!screen) return { error: 'No journal screen', bodyHTML: document.body.innerHTML.slice(0, 300) };
    const mainContent = screen.querySelector('.journal-main-content');
    return {
      screenClass: screen.className,
      parentClass: screen.parentElement?.className,
      parentRect: screen.parentElement?.getBoundingClientRect(),
      mainContentClass: mainContent?.className,
      mainContentRect: mainContent?.getBoundingClientRect(),
      containers: Array.from(mainContent?.querySelectorAll('.journal-container') || []).map(c => ({
        className: c.className,
        rect: c.getBoundingClientRect(),
      })),
      buttons: Array.from(mainContent?.querySelectorAll('button') || []).map(b => ({
        id: b.id,
        text: b.textContent?.trim().slice(0, 20),
        rect: b.getBoundingClientRect(),
      })),
    };
  });
  console.log('Journal info:', JSON.stringify(journalInfo, null, 2));

  await browser.close();
})();
