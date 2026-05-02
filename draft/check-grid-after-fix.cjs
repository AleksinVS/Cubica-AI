const { chromium } = require('playwright');

const DRAFT_URL = 'http://localhost:4000?local=true';
const TARGET_URL = 'http://localhost:3000';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.setViewportSize({ width: 1920, height: 1080 });

  await page.goto(DRAFT_URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  await page.goto(TARGET_URL, { waitUntil: 'networkidle' });
  await page.waitForSelector('.s1-screen, .antarctica-fallback-renderer, .leftsidebar-screen', { timeout: 15000 });
  for (let i = 0; i < 12; i++) {
    const cards = await page.$$('.cards-container .s1-card, .cards-container .game-card');
    if (cards.length >= 4) break;
    const btn = await page.$('button:has-text("ПРОДОЛЖИТЬ"), button:has-text("Продолжить")');
    if (btn) { await btn.click(); await page.waitForTimeout(3000); } else break;
  }
  await page.waitForTimeout(1000);

  const info = await page.evaluate(() => {
    const screen = document.querySelector('.topbar-screen-shell');
    const main = document.querySelector('.topbar-screen-shell .main-content-area');
    const btns = document.querySelector('.topbar-screen-shell .button-container');
    const sScreen = screen ? getComputedStyle(screen) : null;
    const sBtns = btns ? getComputedStyle(btns) : null;
    return {
      gridTemplateRows: sScreen?.gridTemplateRows,
      gridTemplateColumns: sScreen?.gridTemplateColumns,
      mainRect: main?.getBoundingClientRect(),
      btnsRect: btns?.getBoundingClientRect(),
      btnsAlignSelf: sBtns?.alignSelf,
      btnsJustifySelf: sBtns?.justifySelf,
      btnsMarginTop: sBtns?.marginTop,
      btnsMarginBottom: sBtns?.marginBottom,
    };
  });
  console.log(JSON.stringify(info, null, 2));

  await browser.close();
}

main().catch(console.error);
