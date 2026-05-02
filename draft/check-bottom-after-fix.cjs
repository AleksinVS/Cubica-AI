const { chromium } = require('playwright');

const DRAFT_URL = 'http://localhost:4000?local=true';
const TARGET_URL = 'http://localhost:3000';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.setViewportSize({ width: 1920, height: 1080 });

  // Draft
  await page.goto(DRAFT_URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  const draft = await page.evaluate(() => {
    const btns = document.querySelector('.button-container');
    return {
      container: btns?.getBoundingClientRect(),
      buttons: Array.from(btns?.querySelectorAll('button') ?? []).map(b => ({
        className: b.className,
        rect: b.getBoundingClientRect(),
      })),
    };
  });
  console.log('=== DRAFT bottom ===');
  console.log(JSON.stringify(draft, null, 2));

  // Target
  await page.goto(TARGET_URL, { waitUntil: 'networkidle' });
  await page.waitForSelector('.s1-screen, .antarctica-fallback-renderer, .leftsidebar-screen', { timeout: 15000 });
  for (let i = 0; i < 12; i++) {
    const cards = await page.$$('.cards-container .s1-card, .cards-container .game-card');
    if (cards.length >= 4) break;
    const btn = await page.$('button:has-text("ПРОДОЛЖИТЬ"), button:has-text("Продолжить")');
    if (btn) { await btn.click(); await page.waitForTimeout(3000); } else break;
  }
  await page.waitForTimeout(1000);
  const target = await page.evaluate(() => {
    const btns = document.querySelector('.topbar-screen-shell .button-container.antarctica-panel-buttons');
    return {
      container: btns?.getBoundingClientRect(),
      buttons: Array.from(btns?.querySelectorAll('button') ?? []).map(b => ({
        className: b.className,
        rect: b.getBoundingClientRect(),
      })),
    };
  });
  console.log('\n=== TARGET bottom ===');
  console.log(JSON.stringify(target, null, 2));

  await browser.close();
}

main().catch(console.error);
