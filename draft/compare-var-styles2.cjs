const { chromium } = require('playwright');

const DRAFT_URL = 'http://localhost:4000?local=true';
const TARGET_URL = 'http://localhost:3000';

const PROPS = [
  'width','height','minWidth','minHeight','display','flexDirection','alignItems','justifyContent',
  'gap','padding','margin','background','backgroundColor','backgroundImage','backgroundSize',
  'backgroundRepeat','backgroundPosition','border','borderRadius','color','fontFamily',
  'fontSize','fontWeight','lineHeight','textAlign','position','overflow','clipPath',
];

async function extractVar(page, url, selector, advanceToBoard = false) {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(url, { waitUntil: 'networkidle' });
  if (advanceToBoard) {
    for (let i = 0; i < 12; i++) {
      const cards = await page.$$('.cards-container .s1-card, .cards-container .game-card');
      if (cards.length >= 4) break;
      const btn = await page.$('button:has-text("ПРОДОЛЖИТЬ"), button:has-text("Продолжить")');
      if (btn) { await btn.click(); await page.waitForTimeout(3000); } else break;
    }
  }
  await page.waitForTimeout(1000);

  return await page.evaluate(({ sel, props }) => {
    const el = document.querySelector(sel);
    if (!el) return { error: 'not found: ' + sel };
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const o = { tag: el.tagName, class: el.className, rect: { x: r.x, y: r.y, w: r.width, h: r.height } };
    for (const p of props) o[p] = s[p];
    return o;
  }, { sel: selector, props: PROPS });
}

async function main() {
  const browser = await chromium.launch({ headless: true });

  const draftPage = await browser.newPage();
  const draftScore = await extractVar(draftPage, DRAFT_URL, '.game-variables-container .game-variable:last-child');
  const draftNonScore = await extractVar(draftPage, DRAFT_URL, '.game-variables-container .game-variable:first-child');

  const targetPage = await browser.newPage();
  const targetScore = await extractVar(targetPage, TARGET_URL, '.topbar-variables-container .game-variable--score', true);
  const targetNonScore = await extractVar(targetPage, TARGET_URL, '.topbar-variables-container .game-variable:not(.game-variable--score)', true);

  function diff(a, b) {
    const d = {};
    for (const k of Object.keys(a || {})) {
      if (k === 'tag' || k === 'class' || k === 'rect') continue;
      if (a[k] !== b?.[k]) d[k] = { draft: a[k], target: b?.[k] };
    }
    return d;
  }

  console.log('=== SCORE VARIABLE ===');
  console.log(JSON.stringify(diff(draftScore, targetScore), null, 2));
  console.log('\n=== NON-SCORE VARIABLE ===');
  console.log(JSON.stringify(diff(draftNonScore, targetNonScore), null, 2));

  await browser.close();
}

main().catch(console.error);
