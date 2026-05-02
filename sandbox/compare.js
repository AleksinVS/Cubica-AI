const { chromium } = require('playwright');
const path = require('path');

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage();
    
    const filePath = `file://${path.resolve(__dirname, 'journal/index.html')}`;
    await page.goto(filePath);
    await page.setViewportSize({ width: 1920, height: 1080 });
    
    await page.evaluate(() => {
        document.getElementById('reference-overlay').style.display = 'none';
    });
    
    await page.waitForTimeout(500); 
    
    await page.screenshot({ path: 'current.png' });
    console.log('Screenshot saved to current.png');
    
    await browser.close();
})();
