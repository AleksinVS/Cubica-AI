const { chromium } = require('playwright');

const DRAFT_URL = 'http://localhost:4000?local=true';
const TARGET_URL = 'http://localhost:3000';

async function inspectHeader(page, label) {
  const vars = await page.evaluate(() => {
    const els = document.querySelectorAll('.game-variable');
    return Array.from(els).map(v => {
      const rect = v.getBoundingClientRect();
      const caption = v.querySelector('div:last-child, .game-variable-caption');
      const valueEl = v.querySelector('button, .game-variable-value, div:first-child');
      return {
        rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
        text: v.textContent.slice(0, 30),
        captionText: caption ? caption.textContent.slice(0, 20) : null,
        captionStyle: caption ? {
          fontSize: getComputedStyle(caption).fontSize,
          color: getComputedStyle(caption).color,
          lineHeight: getComputedStyle(caption).lineHeight,
          marginTop: getComputedStyle(caption).marginTop,
        } : null,
        valueStyle: valueEl ? {
          fontSize: getComputedStyle(valueEl).fontSize,
          color: getComputedStyle(valueEl).color,
          width: getComputedStyle(valueEl).width,
          height: getComputedStyle(valueEl).height,
          marginBottom: getComputedStyle(valueEl).marginBottom,
          padding: getComputedStyle(valueEl).padding,
          display: getComputedStyle(valueEl).display,
        } : null,
      };
    });
  });
  console.log(`\n=== ${label} variables ===`);
  vars.forEach((v, i) => console.log(`  ${i}: rect=${JSON.stringify(v.rect)} text="${v.text}" caption=${JSON.stringify(v.captionStyle)} value=${JSON.stringify(v.valueStyle)}`));
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
