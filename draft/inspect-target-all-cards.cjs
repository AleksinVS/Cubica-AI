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
      console.log(`Board reached after ${i} iterations, cards=${cards.length}`);
      break;
    }
    const btn = await page.$('button:has-text("ПРОДОЛЖИТЬ"), button:has-text("Продолжить")');
    if (btn) {
      await btn.click();
      await page.waitForTimeout(3000);
    } else {
      console.log(`No button at iteration ${i}, breaking`);
      break;
    }
  }
  await page.waitForTimeout(1000);

  const cards = await page.evaluate(() => {
    const all = document.querySelectorAll('.cards-container > *');
    return Array.from(all).map(c => ({
      tag: c.tagName,
      class: c.className,
      rect: c.getBoundingClientRect(),
      bg: getComputedStyle(c).backgroundColor,
      text: c.textContent ? c.textContent.slice(0, 40) : '',
    }));
  });
  console.log('\nAll cards-container children:');
  cards.forEach((c, i) => console.log(`  ${i}: <${c.tag}> class="${c.class}" rect=(${c.rect.x},${c.rect.y},${c.rect.width},${c.rect.height}) bg=${c.bg} text="${c.text}"`));

  await browser.close();
}

main().catch(console.error);
