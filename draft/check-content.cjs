const { chromium } = require('playwright');

async function checkPage(url, label) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  
  const html = await page.content();
  const shellClass = await page.evaluate(() => {
    const el = document.querySelector('.default-main-screen, .topbar-screen-shell, .leftsidebar-screen, .info-screen-shell, .journal-screen');
    return el ? el.className : 'no shell found';
  });
  const cardCount = await page.evaluate(() => document.querySelectorAll('.game-card, .s1-card').length);
  const buttonCount = await page.evaluate(() => document.querySelectorAll('.button-helper, .s1-button, .action-button').length);
  const varCount = await page.evaluate(() => document.querySelectorAll('.game-variable').length);
  const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 300));
  
  console.log(`\n=== ${label} ===`);
  console.log('Shell class:', shellClass);
  console.log('Cards:', cardCount);
  console.log('Buttons:', buttonCount);
  console.log('Variables:', varCount);
  console.log('Body text:', bodyText);
  
  await browser.close();
}

(async () => {
  await checkPage('http://localhost:4000?local=true', 'DRAFT');
  await checkPage('http://localhost:3000', 'TARGET');
})();
