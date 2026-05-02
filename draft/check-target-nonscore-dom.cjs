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

  const result = await page.evaluate(() => {
    const el = document.querySelector('.topbar-variables-container .game-variable:not(.game-variable--score)');
    if (!el) return { error: 'not found' };
    const img = el.querySelector('.game-variable-image');
    const content = el.querySelector('.game-variable-content');
    const caption = el.querySelector('.game-variable-caption');
    const value = el.querySelector('.game-variable-value');
    return {
      className: el.className,
      width: getComputedStyle(el).width,
      innerHTML: el.innerHTML,
      imgRect: img ? { w: img.getBoundingClientRect().width, h: img.getBoundingClientRect().height } : null,
      contentRect: content ? { w: content.getBoundingClientRect().width, h: content.getBoundingClientRect().height } : null,
      captionWidth: caption ? getComputedStyle(caption).width : null,
      valueWidth: value ? getComputedStyle(value).width : null,
    };
  });

  console.log(JSON.stringify(result, null, 2));
  await browser.close();
}

main().catch(console.error);
