const { chromium } = require('playwright');

const TARGET_URL = 'http://localhost:3000';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1920, height: 1080 });
  
  await page.goto(TARGET_URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  
  // Click "Продолжить" up to 8 times until we see cards
  for (let i = 0; i < 8; i++) {
    const cardCount = await page.evaluate(() =>
      document.querySelectorAll('.cards-container .s1-card, .cards-container .game-card').length
    );
    console.log(`Iteration ${i}: ${cardCount} cards found`);
    
    if (cardCount >= 6) {
      console.log('Board screen reached!');
      break;
    }
    
    const continueButton = await page.$('button:has-text("Продолжить"), .action-button:has-text("Продолжить")');
    if (continueButton) {
      console.log('Clicking Продолжить...');
      await continueButton.click();
      await page.waitForTimeout(2500);
    } else {
      console.log('No continue button found');
      break;
    }
  }
  
  const finalCardCount = await page.evaluate(() =>
    document.querySelectorAll('.cards-container .s1-card, .cards-container .game-card').length
  );
  const shellClass = await page.evaluate(() => {
    const el = document.querySelector('.topbar-screen-shell, .leftsidebar-screen, .info-screen-shell, .journal-screen');
    return el ? el.className : 'none';
  });
  console.log(`Final state: ${shellClass}, ${finalCardCount} cards`);
  
  await page.screenshot({ path: 'draft/visual-diff-results/target-advanced.png', fullPage: false });
  console.log('Screenshot saved: target-advanced.png');
  
  await browser.close();
}

main().catch(console.error);
