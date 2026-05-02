const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

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

  const classes = await page.evaluate(() => {
    const screen = document.querySelector('.s1-screen');
    return screen ? Array.from(screen.classList) : 'not found';
  });
  const hasLeftsidebar = await page.evaluate(() => !!document.querySelector('.leftsidebar-screen'));
  const bodyHTML = await page.evaluate(() => document.querySelector('.s1-screen')?.outerHTML?.slice(0, 500) || 'no s1-screen');
  console.log('Screen classes:', classes);
  console.log('Has leftsidebar:', hasLeftsidebar);
  console.log('Body HTML:', bodyHTML);

  await browser.close();
})();
