/**
 * Unit tests for the ADR-091 global-style boundary detectors.
 *
 * These exercise the pure detection logic (findGlobalStyleGameLeaks and
 * collectGameManifestComponentIds) on synthetic input, so the guard is proven to
 * work before block R3 flips ENFORCE_GLOBAL_STYLE_BOUNDARY to true against the
 * real apps/player-web/app/globals.css.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { afterEach, test } = require("node:test");

const {
  collectGameManifestComponentIds,
  findGlobalStyleGameLeaks
} = require("./validate-game-agnostic.js");

const tempRoots = [];

afterEach(() => {
  while (tempRoots.length > 0) {
    fs.rmSync(tempRoots.pop(), { recursive: true, force: true });
  }
});

test("clean platform CSS produces no leaks", () => {
  const css = `
    :root { --text: #f4fbff; }
    .panel { background: var(--game-background-image, none); }
    .icon { clip-path: url(#clip); mask: url(data:image/svg+xml,AAAA); }
  `;
  assert.deepEqual(findGlobalStyleGameLeaks(css, new Set(["btn-journal"])), []);
});

test("flags baked-in absolute and remote asset url() references", () => {
  const css = `
    #a::before { background-image: url("/images/jurnal-hodov.png"); }
    #b::before { background-image: url(/images/arrow-left.png); }
    #c::before { background-image: url(https://cdn.example.com/x.png); }
  `;
  const leaks = findGlobalStyleGameLeaks(css).join("\n");
  assert.match(leaks, /url\("\/images\/jurnal-hodov\.png"\)/u);
  assert.match(leaks, /url\("\/images\/arrow-left\.png"\)/u);
  assert.match(leaks, /url\("https:\/\/cdn\.example\.com\/x\.png"\)/u);
});

test("flags decorative emoji", () => {
  const css = '.deco::after { content: "🐧🐧"; } .whale::after { content: "🐋"; }';
  const leaks = findGlobalStyleGameLeaks(css);
  assert.equal(leaks.filter((leak) => /decorative emoji/u.test(leak)).length, 1);
});

test("flags id-selectors that a game UI manifest declares", () => {
  const css = "#btn-journal { color: red; } #nav-left::before { content: ''; }";
  const forbidden = new Set(["btn-journal", "nav-left", "unused-id"]);
  const leaks = findGlobalStyleGameLeaks(css, forbidden).join("\n");
  assert.match(leaks, /#btn-journal/u);
  assert.match(leaks, /#nav-left/u);
  assert.doesNotMatch(leaks, /#unused-id/u);
});

test("does not confuse hex colors with forbidden id-selectors", () => {
  // "#f4fbff" must not be read as the id selector "#f4" etc.; also a forbidden
  // id must only match a whole selector token, not a longer id.
  const css = ":root { --text: #f4fbff; } #btn-journal-extended { color: #btn; }";
  const leaks = findGlobalStyleGameLeaks(css, new Set(["btn-journal", "f4"]));
  assert.deepEqual(leaks, []);
});

test("collectGameManifestComponentIds gathers css-safe ids and skips dotted meta ids", () => {
  const gamesRoot = fs.mkdtempSync(path.join(os.tmpdir(), "game-agnostic-ids-"));
  tempRoots.push(gamesRoot);
  const manifestDir = path.join(gamesRoot, "demo", "ui", "web");
  fs.mkdirSync(manifestDir, { recursive: true });
  const manifest = {
    meta: { id: "demo.ui.web" },
    screens: {
      S1: {
        root: {
          type: "screenComponent",
          children: [
            { type: "buttonComponent", id: "btn-journal" },
            { type: "areaComponent", id: "nav-left", children: [{ type: "textComponent", id: "info-title" }] }
          ]
        }
      }
    }
  };
  fs.writeFileSync(path.join(manifestDir, "ui.manifest.json"), JSON.stringify(manifest));

  const ids = collectGameManifestComponentIds(gamesRoot);
  assert.ok(ids.has("btn-journal"));
  assert.ok(ids.has("nav-left"));
  assert.ok(ids.has("info-title"));
  assert.ok(!ids.has("demo.ui.web"), "dotted meta id must be excluded");
});
