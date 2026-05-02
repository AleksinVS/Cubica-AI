const { chromium } = require('playwright');

const TARGET_URL = 'http://localhost:3000';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1920, height: 1080 });
  
  await page.goto(TARGET_URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  
  for (let i = 0; i < 12; i++) {
    const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 200));
    const heading = await page.evaluate(() => {
      const h = document.querySelector('h1, h2, .s1-card-text, .info-event-text .s1-card-text');
      return h ? h.innerText.slice(0, 100) : 'no heading';
    });
    const buttons = await page.evaluate(() =>
      Array.from(document.querySelectorAll('button')).map(b => b.innerText.trim()).slice(0, 5)
    );
    const shell = await page.evaluate(() => {
      const el = document.querySelector('.s1-screen');
      return el ? el.className : 'no s1-screen';
    });
    
    console.log(`\n=== Step ${i} ===`);
    console.log('Shell:', shell);
    console.log('Heading:', heading);
    console.log('Buttons:', buttons);
    
    const continueBtn = await page.$('button:has-text("Продолжить"), button:has-text("Continue")');
    if (continueBtn) {
      await continueBtn.click();
      await page.waitForTimeout(3000);
    } else {
      console.log('No continue button');
      break;
    }
  }
  
  await page.screenshot({ path: 'draft/visual-diff-results/target-final.png', fullPage: false });
  await browser.close();
}

main().catch(console.error);
