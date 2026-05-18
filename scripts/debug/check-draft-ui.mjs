import { chromium } from "playwright";

async function checkDraft() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });

  await page.goto("http://localhost:3000?fixture=journal", { waitUntil: "networkidle" });
  await page.waitForTimeout(3000);

  const screenshotPath = "/home/abc/projects/Cubica-AI/.tmp/screenshots/draft-check.png";
  await page.screenshot({ path: screenshotPath, fullPage: false });
  console.log("Screenshot:", screenshotPath);

  const text = await page.evaluate(() => document.body.innerText);
  console.log("Body text (first 200 chars):", text.substring(0, 200));

  await browser.close();
}

checkDraft().catch(console.error);
