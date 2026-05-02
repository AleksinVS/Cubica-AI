const { chromium } = require('playwright');

const TARGET_URL = 'http://localhost:3000';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.setViewportSize({ width: 1920, height: 1080 });

  await page.goto(TARGET_URL, { waitUntil: 'networkidle' });
  for (let i = 0; i < 12; i++) {
    const cards = await page.$$('.cards-container .s1-card, .cards-container .game-card');
    if (cards.length >= 4) break;
    const btn = await page.$('button:has-text("ПРОДОЛЖИТЬ"), button:has-text("Продолжить")');
    if (btn) { await btn.click(); await page.waitForTimeout(3000); } else break;
  }
  await page.waitForTimeout(1000);

  const stack = await page.evaluate(() => {
    const elements = document.elementsFromPoint(960, 1020);
    return elements.slice(0, 8).map(e => ({
      tag: e.tagName,
      cls: e.className,
      rect: e.getBoundingClientRect(),
      bg: getComputedStyle(e).backgroundColor,
    }));
  });
  console.log('Stack at (960,1020):');
  stack.forEach((e, i) => console.log(`  ${i}: <${e.tag}> class="${e.cls}" rect=(${e.rect.x},${e.rect.y},${e.rect.width},${e.rect.height}) bg=${e.bg}`));

  const buttons = await page.evaluate(() => {
    const all = document.querySelectorAll('.button-container button');
    return Array.from(all).map(b => ({
      text: b.textContent.slice(0, 20),
      rect: b.getBoundingClientRect(),
      cls: b.className,
    }));
  });
  console.log('\nButton container buttons:');
  buttons.forEach((b, i) => console.log(`  ${i}: text="${b.text}" rect=(${b.rect.x},${b.rect.y},${b.rect.width},${b.rect.height}) class="${b.cls}"`));

  await browser.close();
}

main().catch(console.error);
