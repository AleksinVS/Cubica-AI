const { chromium } = require('playwright');

const DRAFT_URL = 'http://localhost:4000?local=true';
const TARGET_URL = 'http://localhost:3000';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.setViewportSize({ width: 1920, height: 1080 });

  // Visit draft first (resets shared state)
  await page.goto(DRAFT_URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  console.log('Visited draft');

  // Now target
  await page.goto(TARGET_URL, { waitUntil: 'networkidle' });
  for (let i = 0; i < 12; i++) {
    const cards = await page.$$('.cards-container .s1-card, .cards-container .game-card, .topbar-cards-container .s1-card');
    console.log(`Step ${i}: cards.length = ${cards.length}`);
    if (cards.length >= 4) break;
    const btn = await page.$('button:has-text("ПРОДОЛЖИТЬ"), button:has-text("Продолжить")');
    if (btn) {
      console.log('Clicking continue...');
      await btn.click();
      await page.waitForTimeout(3000);
    } else {
      console.log('No continue button, breaking');
      break;
    }
  }
  await page.waitForTimeout(1000);

  const info = await page.evaluate(() => {
    const screen = document.querySelector('.topbar-screen-shell, .info-screen-shell, .s1-screen');
    const allContainers = Array.from(document.querySelectorAll('[class*="cards-container"], [class*="cards_container"]'));
    const container = allContainers[0] ?? null;
    const cards = container ? container.querySelectorAll(':scope > *') : [];
    return {
      screenClass: screen?.className,
      allContainerClasses: allContainers.map(c => c.className),
      containerClass: container?.className,
      cardCount: cards.length,
      cards: Array.from(cards).map((c, i) => ({
        index: i,
        tag: c.tagName,
        className: c.className,
        text: c.textContent.trim().substring(0, 100),
      })),
    };
  });
  console.log(JSON.stringify(info, null, 2));

  await browser.close();
}

main().catch(console.error);
