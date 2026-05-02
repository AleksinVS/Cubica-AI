const { chromium } = require('playwright');

const TARGET_URL = 'http://localhost:3000';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(TARGET_URL, { waitUntil: 'networkidle' });
  for (let i = 0; i < 12; i++) {
    const cards = await page.$$eval('.cards-container .s1-card, .cards-container .game-card', el => el.length);
    if (cards >= 4) break;
    const btn = await page.$('button:has-text("ПРОДОЛЖИТЬ"), button:has-text("Продолжить")');
    if (btn) { await btn.click(); await page.waitForTimeout(3000); } else break;
  }
  await page.waitForTimeout(1000);

  const info = await page.evaluate(() => {
    const vars = document.querySelectorAll('.game-variable:not(.game-variable--score)');
    if (!vars.length) return { error: 'No vars found', html: document.body.innerHTML.substring(0,500) };
    const el = vars[0];
    const caption = el.querySelector('.game-variable-caption');
    const s = caption ? getComputedStyle(caption) : null;
    const val = el.querySelector('.game-variable-value');
    const vs = val ? getComputedStyle(val) : null;
    return {
      varClassName: el.className,
      captionFontSize: s?.fontSize,
      captionColor: s?.color,
      captionFontWeight: s?.fontWeight,
      captionTextTransform: s?.textTransform,
      valueColor: vs?.color,
      valueFontSize: vs?.fontSize,
    };
  });

  console.log(JSON.stringify(info, null, 2));
  await browser.close();
}

main().catch(console.error);
