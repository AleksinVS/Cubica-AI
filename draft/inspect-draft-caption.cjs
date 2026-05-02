const { chromium } = require('playwright');

const DRAFT_URL = 'http://localhost:4000?local=true';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(DRAFT_URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  const info = await page.evaluate(() => {
    const vars = document.querySelectorAll('.default-main-screen .game-variables-container .game-variable:not(.game-variable--score)');
    if (!vars.length) return { error: 'No vars found' };
    const el = vars[0];
    const children = Array.from(el.children).map(c => ({
      tag: c.tagName,
      class: c.className,
      text: c.textContent?.substring(0, 20),
      rect: c.getBoundingClientRect(),
      style: {
        width: getComputedStyle(c).width,
        height: getComputedStyle(c).height,
        fontSize: getComputedStyle(c).fontSize,
        color: getComputedStyle(c).color,
        whiteSpace: getComputedStyle(c).whiteSpace,
      }
    }));
    return {
      varWidth: getComputedStyle(el).width,
      varHeight: getComputedStyle(el).height,
      children,
    };
  });

  console.log(JSON.stringify(info, null, 2));
  await browser.close();
}

main().catch(console.error);
