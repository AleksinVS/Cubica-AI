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

  // Check screen type
  const hasTopbar = await page.$('.topbar-screen-shell') !== null;
  const hasInfo = await page.$('.info-screen-shell') !== null;
  console.log(`hasTopbar=${hasTopbar}, hasInfo=${hasInfo}`);

  // What's at (900,500)?
  const stack = await page.evaluate(() => {
    const elements = document.elementsFromPoint(900, 500);
    return elements.slice(0, 8).map(e => ({
      tag: e.tagName,
      cls: e.className,
      bg: getComputedStyle(e).backgroundColor,
      opacity: getComputedStyle(e).opacity,
    }));
  });
  console.log('\nStack at (900,500):');
  stack.forEach((e, i) => console.log(`  ${i}: <${e.tag}> class="${e.cls}" bg=${e.bg} opacity=${e.opacity}`));

  // What cards exist?
  const cardInfos = await page.evaluate(() => {
    const cards = document.querySelectorAll('.cards-container .s1-card, .cards-container .game-card');
    return Array.from(cards).slice(0, 4).map(c => ({
      class: c.className,
      rect: c.getBoundingClientRect(),
      bg: getComputedStyle(c).backgroundColor,
      color: getComputedStyle(c).color,
    }));
  });
  console.log('\nCards:');
  cardInfos.forEach((c, i) => console.log(`  ${i}: class="${c.class}" rect=(${c.rect.x},${c.rect.y},${c.rect.width},${c.rect.height}) bg=${c.bg} color=${c.color}`));

  // Variables
  const vars = await page.evaluate(() => {
    const els = document.querySelectorAll('.game-variable, .antarctica-variable');
    return Array.from(els).slice(0, 6).map(v => ({
      class: v.className,
      rect: v.getBoundingClientRect(),
      text: v.textContent.slice(0, 20),
    }));
  });
  console.log('\nVariables:');
  vars.forEach((v, i) => console.log(`  ${i}: class="${v.class}" rect=(${v.rect.x},${v.rect.y},${v.rect.width},${v.rect.height}) text="${v.text}"`));

  await browser.close();
}

main().catch(console.error);
