const { chromium } = require('playwright');

const TARGET_URL = 'http://localhost:3000';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(TARGET_URL, { waitUntil: 'networkidle' });

  for (let i = 0; i < 12; i++) {
    const cards = await page.$$('.cards-container .s1-card, .cards-container .game-card');
    const btn = await page.$('button:has-text("ПРОДОЛЖИТЬ"), button:has-text("Продолжить")');
    const infoScreen = await page.$('.info-screen-shell');
    const topbarScreen = await page.$('.topbar-screen-shell');
    console.log(`Iteration ${i}: cards=${cards.length}, btn=${!!btn}, infoScreen=${!!infoScreen}, topbarScreen=${!!topbarScreen}`);
    if (cards.length >= 4) {
      console.log('  Breaking because cards >= 4');
      break;
    }
    if (btn) {
      await btn.click();
      await page.waitForTimeout(3000);
    } else {
      console.log('  Breaking because no button');
      break;
    }
  }

  // Final state
  const finalCards = await page.$$('.cards-container .s1-card, .cards-container .game-card');
  const finalInfo = await page.$('.info-screen-shell');
  const finalTopbar = await page.$('.topbar-screen-shell');
  console.log(`\nFinal: cards=${finalCards.length}, infoScreen=${!!finalInfo}, topbarScreen=${!!finalTopbar}`);

  // Check visibility
  if (finalInfo) {
    const visible = await finalInfo.evaluate(e => getComputedStyle(e).display !== 'none');
    console.log(`info-screen-shell visible: ${visible}`);
  }
  if (finalTopbar) {
    const visible = await finalTopbar.evaluate(e => getComputedStyle(e).display !== 'none');
    console.log(`topbar-screen-shell visible: ${visible}`);
  }

  await browser.close();
}

main().catch(console.error);
