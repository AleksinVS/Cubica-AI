const { chromium } = require('playwright');

const DRAFT_URL = 'http://localhost:4000?local=true';
const TARGET_URL = 'http://localhost:3000';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.setViewportSize({ width: 1920, height: 1080 });

  // Visit draft first (same as visual-diff.js)
  await page.goto(DRAFT_URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  // Then visit target
  await page.goto(TARGET_URL, { waitUntil: 'networkidle' });
  for (let i = 0; i < 12; i++) {
    const cards = await page.$$('.cards-container .s1-card, .cards-container .game-card');
    if (cards.length >= 4) break;
    const btn = await page.$('button:has-text("ПРОДОЛЖИТЬ"), button:has-text("Продолжить")');
    if (btn) { await btn.click(); await page.waitForTimeout(3000); } else break;
  }
  await page.waitForTimeout(1000);

  const vars = await page.evaluate(() => {
    const els = document.querySelectorAll('.game-variable, .antarctica-variable');
    return Array.from(els).slice(0, 8).map(v => {
      const rect = v.getBoundingClientRect();
      return {
        class: v.className,
        rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
        text: v.textContent.slice(0, 20),
      };
    });
  });
  console.log('Variables in visual-diff flow:');
  vars.forEach((v, i) => console.log(`  ${i}: class="${v.class}" rect=(${v.rect.x},${v.rect.y},${v.rect.w},${v.rect.h}) text="${v.text}"`));

  const containers = await page.evaluate(() => {
    const els = document.querySelectorAll('.game-variables-container, .topbar-variables-container');
    return Array.from(els).map(c => ({
      class: c.className,
      rect: c.getBoundingClientRect(),
      display: getComputedStyle(c).display,
      flexDirection: getComputedStyle(c).flexDirection,
    }));
  });
  console.log('\nVariable containers:');
  containers.forEach((c, i) => console.log(`  ${i}: class="${c.class}" rect=(${c.rect.x},${c.rect.y},${c.rect.w},${c.rect.h}) display=${c.display} flexDir=${c.flexDirection}`));

  await browser.close();
}

main().catch(console.error);
