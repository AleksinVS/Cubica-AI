const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');
const pixelmatch = require('pixelmatch').default;

const DRAFT_URL = 'http://localhost:4000';
const TARGET_URL = 'http://localhost:3000';
const OUTPUT_DIR = path.join(__dirname, 'visual-diff-results');

if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

async function capturePage(page, url, waitSelector, viewport, outputPath, label, advanceToBoard = false) {
  await page.setViewportSize(viewport);
  await page.goto(url, { waitUntil: 'networkidle' });

  if (waitSelector) {
    try {
      await page.waitForSelector(waitSelector, { timeout: 15000 });
      console.log(`[${label}] Content loaded: ${waitSelector}`);
    } catch (err) {
      console.warn(`[${label}] Timeout waiting for ${waitSelector}, capturing anyway`);
    }
  }

  // Advance target through info screens until board screen appears
  if (advanceToBoard) {
    for (let i = 0; i < 12; i++) {
      const cards = await page.$$('.cards-container .s1-card, .cards-container .game-card');
      if (cards.length >= 4) {
        console.log(`[${label}] Board screen reached after ${i} clicks`);
        break;
      }
      const continueBtn = await page.$('button:has-text("ПРОДОЛЖИТЬ"), button:has-text("Продолжить")');
      if (continueBtn) {
        console.log(`[${label}] Clicking Продолжить (step ${i + 1})...`);
        await continueBtn.click();
        await page.waitForTimeout(3000);
      } else {
        console.log(`[${label}] No continue button found at step ${i}`);
        break;
      }
    }
  }

  await page.waitForTimeout(1000); // Extra wait for animations
  await page.screenshot({ path: outputPath, fullPage: false });
  console.log(`[${label}] Screenshot saved: ${outputPath}`);
}

async function compareScreenshots(baselinePath, currentPath, diffPath) {
  const baseline = PNG.sync.read(fs.readFileSync(baselinePath));
  const current = PNG.sync.read(fs.readFileSync(currentPath));

  const width = Math.min(baseline.width, current.width);
  const height = Math.min(baseline.height, current.height);

  const diff = new PNG({ width, height });

  const diffPixels = pixelmatch(
    baseline.data,
    current.data,
    diff.data,
    width,
    height,
    { threshold: 0.1, includeAA: true }
  );

  fs.writeFileSync(diffPath, PNG.sync.write(diff));

  const totalPixels = width * height;
  const diffPercentage = (diffPixels / totalPixels) * 100;

  return { diffPixels, diffPercentage, width, height };
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  const viewport = { width: 1920, height: 1080 };

  // Capture draft topbar (board screen)
  await capturePage(
    page,
    `${DRAFT_URL}?local=true`,
    '.default-main-screen',
    viewport,
    path.join(OUTPUT_DIR, 'draft-topbar.png'),
    'DRAFT',
    false
  );

  // Capture target topbar (advance to board screen first)
  await capturePage(
    page,
    TARGET_URL,
    '.s1-screen, .antarctica-fallback-renderer, .leftsidebar-screen',
    viewport,
    path.join(OUTPUT_DIR, 'target-topbar.png'),
    'TARGET',
    true
  );

  // Compare
  console.log('\n=== Comparing screenshots ===');
  const result = await compareScreenshots(
    path.join(OUTPUT_DIR, 'draft-topbar.png'),
    path.join(OUTPUT_DIR, 'target-topbar.png'),
    path.join(OUTPUT_DIR, 'diff-topbar.png')
  );

  console.log(`\n=== Results ===`);
  console.log(`Topbar screen:`);
  console.log(`  Different pixels: ${result.diffPixels.toLocaleString()}`);
  console.log(`  Difference: ${result.diffPercentage.toFixed(2)}%`);
  console.log(`  Resolution: ${result.width}x${result.height}`);
  console.log(`  Diff image: ${path.join(OUTPUT_DIR, 'diff-topbar.png')}`);

  if (result.diffPercentage > 5) {
    console.log(`  ⚠️  SIGNIFICANT VISUAL DIFFERENCE DETECTED`);
  } else if (result.diffPercentage > 1) {
    console.log(`  ⚠️  Minor visual differences`);
  } else {
    console.log(`  ✅ Visual match acceptable`);
  }

  await browser.close();
}

main().catch(console.error);
