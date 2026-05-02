const { chromium } = require('playwright');

async function getDraftComputed() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('http://localhost:4000?local=true&screen=journal', { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  
  const info = await page.evaluate(() => {
    const h1 = document.querySelector('.heading-h1');
    const card = document.querySelector('.game-card');
    const metric = document.querySelector('.journal-variable-component, .default-journal-variable-component');
    const btn = document.querySelector('.button-container button');
    
    return {
      h1: h1 ? {
        fontSize: window.getComputedStyle(h1).fontSize,
        padding: window.getComputedStyle(h1).padding,
        margin: window.getComputedStyle(h1).margin,
        textAlign: window.getComputedStyle(h1).textAlign,
      } : null,
      card: card ? {
        padding: window.getComputedStyle(card).padding,
        backgroundColor: window.getComputedStyle(card).backgroundColor,
        fontSize: window.getComputedStyle(card).fontSize,
        fontWeight: window.getComputedStyle(card).fontWeight,
      } : null,
      metric: metric ? {
        marginTop: window.getComputedStyle(metric).marginTop,
        fontSize: window.getComputedStyle(metric).fontSize,
      } : null,
      metricValue: metric ? {
        fontSize: window.getComputedStyle(metric.querySelector('.journal-variable__value')).fontSize,
      } : null,
      btn: btn ? {
        fontSize: window.getComputedStyle(btn).fontSize,
        padding: window.getComputedStyle(btn).padding,
      } : null,
    };
  });
  
  await browser.close();
  return info;
}

async function getTargetComputed() {
  const res = await fetch('http://localhost:3009/api/runtime/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gameId: 'antarctica', playerId: 'player-web' })
  });
  const data = await res.json();
  const sessionId = data.sessionId;
  await fetch('http://localhost:3009/api/runtime/actions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, playerId: 'player-web', actionId: 'showHistory' })
  });

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('http://localhost:3009', { waitUntil: 'networkidle' });
  await page.evaluate((sid) => {
    localStorage.setItem('cubica-antarctica-session-id', sid);
  }, sessionId);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  
  const info = await page.evaluate(() => {
    const h1 = document.querySelector('.heading-h1');
    const card = document.querySelector('.journal-entry-card');
    const metric = document.querySelector('.journal-variable-component');
    const btn = document.querySelector('.journal-main-content .button-container button');
    
    return {
      h1: h1 ? {
        fontSize: window.getComputedStyle(h1).fontSize,
        padding: window.getComputedStyle(h1).padding,
        margin: window.getComputedStyle(h1).margin,
        textAlign: window.getComputedStyle(h1).textAlign,
      } : null,
      card: card ? {
        padding: window.getComputedStyle(card).padding,
        backgroundColor: window.getComputedStyle(card).backgroundColor,
        fontSize: window.getComputedStyle(card).fontSize,
        fontWeight: window.getComputedStyle(card).fontWeight,
      } : null,
      metric: metric ? {
        marginTop: window.getComputedStyle(metric).marginTop,
        fontSize: window.getComputedStyle(metric).fontSize,
      } : null,
      metricValue: metric ? {
        fontSize: window.getComputedStyle(metric.querySelector('.journal-variable__value')).fontSize,
      } : null,
      btn: btn ? {
        fontSize: window.getComputedStyle(btn).fontSize,
        padding: window.getComputedStyle(btn).padding,
      } : null,
    };
  });
  
  await browser.close();
  return info;
}

(async () => {
  const draft = await getDraftComputed();
  const target = await getTargetComputed();
  console.log('DRAFT:', JSON.stringify(draft, null, 2));
  console.log('TARGET:', JSON.stringify(target, null, 2));
})();
