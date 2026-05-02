const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');
const pixelmatch = require('pixelmatch').default || require('pixelmatch');

const DRAFT_URL = 'http://localhost:4000';
const TARGET_URL = 'http://localhost:3009';
const TARGET_API = 'http://localhost:3009/api/runtime';
const OUTPUT_DIR = path.join(__dirname, 'visual-diff-results');

if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

async function createSession() {
  const res = await fetch(`${TARGET_API}/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gameId: 'antarctica', playerId: 'player-web' })
  });
  const data = await res.json();
  return data.sessionId;
}

async function dispatchAction(sessionId, actionId) {
  await fetch(`${TARGET_API}/actions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, playerId: 'player-web', actionId })
  });
}

async function captureDraftHint(page, outputPath) {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(`${DRAFT_URL}?local=true&screen=hint`, { waitUntil: 'networkidle' });
  try {
    await page.waitForSelector('.antarctica-hint-screen, .hint-area, .main-screen', { timeout: 15000 });
  } catch {
    console.warn('Draft hint selector not found, capturing anyway');
  }
  await page.waitForTimeout(5000);
  await page.screenshot({ path: outputPath, fullPage: false });
  console.log(`[DRAFT] Hint screenshot: ${outputPath}`);
}

async function captureTargetHint(page, sessionId, outputPath) {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(TARGET_URL, { waitUntil: 'networkidle' });
  await page.evaluate((sid) => {
    localStorage.setItem('cubica-antarctica-session-id', sid);
  }, sessionId);
  await page.reload({ waitUntil: 'networkidle' });
  try {
    await page.waitForSelector('.antarctica-hint-screen', { timeout: 15000 });
  } catch {
    console.warn('Target hint selector not found, capturing anyway');
  }
  await page.waitForTimeout(5000);
  await page.screenshot({ path: outputPath, fullPage: false });
  console.log(`[TARGET] Hint screenshot: ${outputPath}`);
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

  // Capture draft first
  await captureDraftHint(page, path.join(OUTPUT_DIR, 'draft-hint.png'));

  // Capture target
  const sessionId = await createSession();
  await dispatchAction(sessionId, 'showHint');
  await captureTargetHint(page, sessionId, path.join(OUTPUT_DIR, 'target-hint.png'));

  console.log('\n=== Comparing hint screenshots ===');
  const result = await compareScreenshots(
    path.join(OUTPUT_DIR, 'draft-hint.png'),
    path.join(OUTPUT_DIR, 'target-hint.png'),
    path.join(OUTPUT_DIR, 'diff-hint.png')
  );
  console.log(`Different pixels: ${result.diffPixels.toLocaleString()}`);
  console.log(`Difference: ${result.diffPercentage.toFixed(2)}%`);
  console.log(`Resolution: ${result.width}x${result.height}`);

  if (result.diffPercentage > 5) {
    console.log('⚠️  SIGNIFICANT VISUAL DIFFERENCE DETECTED');
  } else if (result.diffPercentage > 1) {
    console.log('⚠️  Minor visual differences');
  } else {
    console.log('✅ Visual match acceptable');
  }

  await browser.close();
}

main().catch(console.error);
