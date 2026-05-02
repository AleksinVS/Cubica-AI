const { chromium } = require('playwright');

const DRAFT_URL = 'http://localhost:4000?local=true';
const TARGET_URL = 'http://localhost:3000';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.setViewportSize({ width: 1920, height: 1080 });

  await page.goto(DRAFT_URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  await page.goto(TARGET_URL, { waitUntil: 'networkidle' });
  await page.waitForSelector('.s1-screen, .antarctica-fallback-renderer, .leftsidebar-screen', { timeout: 15000 });
  await page.waitForTimeout(1000);

  const info = await page.evaluate(() => {
    const btns = document.querySelectorAll('button');
    return Array.from(btns).map(b => ({
      text: b.textContent.trim(),
      className: b.className,
      disabled: b.disabled,
      parentClassName: b.parentElement?.className,
    }));
  });
  console.log(JSON.stringify(info, null, 2));

  await browser.close();
}

main().catch(console.error);
