const { chromium } = require('playwright');

const DRAFT_URL = 'http://localhost:4000?local=true';
const TARGET_URL = 'http://localhost:3000';

const PROPS = [
  'display','flexDirection','alignItems','justifyContent','gap','width','height',
  'minWidth','minHeight','maxWidth','maxHeight','padding','margin','background',
  'backgroundColor','border','borderRadius','position','top','left','right','bottom',
  'gridColumn','gridRow','boxSizing','overflow','clipPath',
];

async function extractVars(page, url, label, advanceToBoard = false) {
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

  return await page.evaluate((props) => {
    const container = document.querySelector('.game-variables-container, .topbar-variables-container');
    const score = document.querySelector('.game-variable--score, .game-variable--topbar');
    const nonScore = document.querySelector('.game-variable:not(.game-variable--score)');
    const cards = document.querySelector('.cards-container');
    const header = document.querySelector('.topbar-board-header, .default-board-header, .s1-board-header');

    function grab(el) {
      if (!el) return null;
      const s = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      const o = { tag: el.tagName, class: el.className, rect: { x:r.x, y:r.y, w:r.width, h:r.height } };
      for (const p of props) o[p] = s[p];
      return o;
    }

    return {
      container: grab(container),
      score: grab(score),
      nonScore: grab(nonScore),
      cards: grab(cards),
      header: grab(header),
    };
  }, PROPS);
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  const draft = await extractVars(page, DRAFT_URL, 'DRAFT', false);
  const target = await extractVars(page, TARGET_URL, 'TARGET', true);

  function diff(a, b) {
    const d = {};
    for (const k of Object.keys(a || {})) {
      if (k === 'tag' || k === 'class' || k === 'rect') continue;
      if (a[k] !== b?.[k]) d[k] = { draft: a[k], target: b?.[k] };
    }
    return d;
  }

  console.log('=== CONTAINER ===');
  console.log(JSON.stringify(diff(draft.container, target.container), null, 2));
  console.log('\n=== SCORE ===');
  console.log(JSON.stringify(diff(draft.score, target.score), null, 2));
  console.log('\n=== NON-SCORE ===');
  console.log(JSON.stringify(diff(draft.nonScore, target.nonScore), null, 2));
  console.log('\n=== CARDS ===');
  console.log(JSON.stringify(diff(draft.cards, target.cards), null, 2));
  console.log('\n=== HEADER ===');
  console.log(JSON.stringify(diff(draft.header, target.header), null, 2));

  await browser.close();
}

main().catch(console.error);
