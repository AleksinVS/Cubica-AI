const { chromium } = require('playwright');

const DRAFT_URL = 'http://localhost:4000?local=true';
const TARGET_URL = 'http://localhost:3000';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();

  const page = await context.newPage();
  await page.setViewportSize({ width: 1920, height: 1080 });

  // Same flow as visual-diff.js: draft first (no advance), then target (advance)
  await page.goto(DRAFT_URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  const draftInfo = await page.evaluate(() => {
    const cards = document.querySelectorAll('.cards-container .game-card');
    const rects = Array.from(cards).map(c => {
      const r = c.getBoundingClientRect();
      return { width: r.width, height: r.height, top: r.top, left: r.left };
    });
    const container = document.querySelector('.cards-container');
    const containerR = container ? container.getBoundingClientRect() : null;
    const screen = document.querySelector('.default-main-screen');
    const screenR = screen ? screen.getBoundingClientRect() : null;
    const btns = document.querySelector('.button-container');
    const btnsR = btns ? btns.getBoundingClientRect() : null;
    return { rects, container: containerR, screen: screenR, buttons: btnsR };
  });
  console.log('=== DRAFT ===');
  console.log('Cards:', JSON.stringify(draftInfo.rects, null, 2));
  console.log('Container:', JSON.stringify(draftInfo.container, null, 2));
  console.log('Buttons:', JSON.stringify(draftInfo.buttons, null, 2));
  console.log('Screen:', JSON.stringify(draftInfo.screen, null, 2));

  // Now target with advanceToBoard logic
  await page.goto(TARGET_URL, { waitUntil: 'networkidle' });
  for (let i = 0; i < 12; i++) {
    const cards = await page.$$('.cards-container .s1-card, .cards-container .game-card');
    if (cards.length >= 4) break;
    const btn = await page.$('button:has-text("ПРОДОЛЖИТЬ"), button:has-text("Продолжить")');
    if (btn) { await btn.click(); await page.waitForTimeout(3000); } else break;
  }
  await page.waitForTimeout(1000);

  const targetInfo = await page.evaluate(() => {
    const cards = document.querySelectorAll('.cards-container .s1-card');
    const rects = Array.from(cards).map(c => {
      const r = c.getBoundingClientRect();
      return { width: r.width, height: r.height, top: r.top, left: r.left };
    });
    const container = document.querySelector('.topbar-screen-shell .cards-container');
    const containerR = container ? container.getBoundingClientRect() : null;
    const screen = document.querySelector('.topbar-screen-shell');
    const screenR = screen ? screen.getBoundingClientRect() : null;
    const main = document.querySelector('.topbar-screen-shell .main-content-area');
    const mainR = main ? main.getBoundingClientRect() : null;
    const btns = document.querySelector('.topbar-screen-shell .button-container');
    const btnsR = btns ? btns.getBoundingClientRect() : null;
    const bottom = document.querySelector('.topbar-screen-shell .info-bottom-controls');
    const bottomR = bottom ? bottom.getBoundingClientRect() : null;
    const header = document.querySelector('.topbar-screen-shell .topbar-board-header');
    const headerR = header ? header.getBoundingClientRect() : null;
    return { rects, container: containerR, screen: screenR, main: mainR, buttons: btnsR, bottom: bottomR, header: headerR };
  });
  console.log('\n=== TARGET ===');
  console.log('Cards:', JSON.stringify(targetInfo.rects, null, 2));
  console.log('Container:', JSON.stringify(targetInfo.container, null, 2));
  console.log('Main:', JSON.stringify(targetInfo.main, null, 2));
  console.log('Header:', JSON.stringify(targetInfo.header, null, 2));
  console.log('Bottom:', JSON.stringify(targetInfo.bottom, null, 2));
  console.log('Buttons:', JSON.stringify(targetInfo.buttons, null, 2));
  console.log('Screen:', JSON.stringify(targetInfo.screen, null, 2));

  await browser.close();
}

main().catch(console.error);
