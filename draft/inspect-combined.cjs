const { chromium } = require('playwright');

const TARGET_URL = 'http://localhost:3000';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(TARGET_URL, { waitUntil: 'networkidle' });

  for (let i = 0; i < 12; i++) {
    const cards = await page.$$('.cards-container .s1-card, .cards-container .game-card');
    if (cards.length >= 4) {
      console.log(`Iteration ${i}: cards=${cards.length}, breaking`);
      break;
    }
    const btn = await page.$('button:has-text("ПРОДОЛЖИТЬ"), button:has-text("Продолжить")');
    if (btn) {
      await btn.click();
      await page.waitForTimeout(3000);
    } else {
      console.log(`Iteration ${i}: no button, breaking`);
      break;
    }
  }
  await page.waitForTimeout(1000);

  const hasInfo = await page.$('.info-screen-shell') !== null;
  const hasTopbar = await page.$('.topbar-screen-shell') !== null;
  console.log(`hasInfo=${hasInfo}, hasTopbar=${hasTopbar}`);

  const stack = await page.evaluate(() => {
    const elements = document.elementsFromPoint(900, 500);
    return elements.slice(0, 8).map(e => ({
      tag: e.tagName,
      cls: e.className,
      display: getComputedStyle(e).display,
      visibility: getComputedStyle(e).visibility,
      bg: getComputedStyle(e).backgroundColor,
      bgImage: getComputedStyle(e).backgroundImage.slice(0, 60),
    }));
  });
  console.log('\nStack at (900,500):');
  stack.forEach((e, i) => console.log(`  ${i}: <${e.tag}> class="${e.cls}" display=${e.display} bg=${e.bg}`));

  await browser.close();
}

main().catch(console.error);
