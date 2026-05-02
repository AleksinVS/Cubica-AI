const { chromium } = require('playwright');

const DRAFT_URL = 'http://localhost:4000?local=true';
const TARGET_URL = 'http://localhost:3000';

async function inspectHeader(page, label) {
  const vars = await page.evaluate(() => {
    const els = document.querySelectorAll('.game-variable');
    return Array.from(els).slice(0, 4).map(v => {
      const rect = v.getBoundingClientRect();
      const caption = v.querySelector('.game-variable-caption');
      const valueEl = v.querySelector('.game-variable-value');
      const imgEl = v.querySelector('.game-variable-image, .game-variable-visual');
      return {
        rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
        caption: caption ? {
          fontSize: getComputedStyle(caption).fontSize,
          color: getComputedStyle(caption).color,
          marginTop: getComputedStyle(caption).marginTop,
          text: caption.textContent.slice(0, 15),
        } : null,
        value: valueEl ? {
          fontSize: getComputedStyle(valueEl).fontSize,
          color: getComputedStyle(valueEl).color,
          text: valueEl.textContent.slice(0, 10),
        } : null,
        image: imgEl ? {
          width: getComputedStyle(imgEl).width,
          height: getComputedStyle(imgEl).height,
          marginBottom: getComputedStyle(imgEl).marginBottom,
          padding: getComputedStyle(imgEl).padding,
        } : null,
      };
    });
  });
  console.log(`\n=== ${label} variables ===`);
  vars.forEach((v, i) => console.log(`  ${i}: rect=${JSON.stringify(v.rect)} caption=${JSON.stringify(v.caption)} value=${JSON.stringify(v.value)} image=${JSON.stringify(v.image)}`));
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.setViewportSize({ width: 1920, height: 1080 });

  await page.goto(DRAFT_URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await inspectHeader(page, 'DRAFT');

  await page.goto(TARGET_URL, { waitUntil: 'networkidle' });
  for (let i = 0; i < 12; i++) {
    const cards = await page.$$('.cards-container .s1-card, .cards-container .game-card');
    if (cards.length >= 4) break;
    const btn = await page.$('button:has-text("ПРОДОЛЖИТЬ"), button:has-text("Продолжить")');
    if (btn) { await btn.click(); await page.waitForTimeout(3000); } else break;
  }
  await page.waitForTimeout(1000);
  await inspectHeader(page, 'TARGET');

  await browser.close();
}

main().catch(console.error);
