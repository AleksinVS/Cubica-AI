/**
 * End-to-end regression tests for ui-visual-tool.mjs.
 *
 * Tests invoke the public CLI instead of importing implementation details.
 * This verifies argument parsing, exit codes, reports, and generated artifacts
 * in the same way an agent or CI job uses the skill.
 */

import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import test, { after, before } from "node:test";
import { PNG } from "pngjs";
import { chromium } from "playwright";

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const TOOL = path.join(ROOT, "skills/C_ui-compare/scripts/ui-visual-tool.mjs");
const TMP = path.join(ROOT, ".tmp/ui-compare-tests");

function writePng(filePath, width, height, painter) {
  const image = new PNG({ width, height });
  for (let i = 0; i < image.data.length; i += 4) {
    image.data[i] = 255;
    image.data[i + 1] = 255;
    image.data[i + 2] = 255;
    image.data[i + 3] = 255;
  }
  painter?.(image);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, PNG.sync.write(image));
}

function fillRect(image, x, y, width, height, color = [0, 0, 0]) {
  for (let yy = y; yy < y + height; yy++) {
    for (let xx = x; xx < x + width; xx++) {
      const offset = (yy * image.width + xx) * 4;
      image.data[offset] = color[0];
      image.data[offset + 1] = color[1];
      image.data[offset + 2] = color[2];
    }
  }
}

function inventory(regions) {
  return {
    $schema: "https://cubica.local/schemas/ui-comparison-inventory.v1.json",
    schemaVersion: "1.0",
    source: {
      kind: "owned-original",
      usageRights: "owned",
      uri: "test-fixture",
    },
    canvas: { width: 320, height: 240 },
    regions,
  };
}

function region(id, role, bounds, extra = {}) {
  return { id, type: role === "control" ? "button" : role, role, layer: role === "background" ? 0 : 1, bounds, ...extra };
}

function run(args, options = {}) {
  try {
    const stdout = execFileSync(process.execPath, [TOOL, ...args], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, stdout };
  } catch (error) {
    if (!options.allowFailure) throw error;
    return {
      code: error.status,
      stdout: String(error.stdout || ""),
      stderr: String(error.stderr || ""),
    };
  }
}

before(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(TMP, { recursive: true });
});

after(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
});

test("background-only inventory cannot pass detail coverage validation", () => {
  const imagePath = path.join(TMP, "reference.png");
  const inventoryPath = path.join(TMP, "background-only.json");
  writePng(imagePath, 320, 240, (image) => fillRect(image, 80, 70, 100, 50));
  fs.writeFileSync(inventoryPath, JSON.stringify(inventory([
    region("background", "background", { x: 0, y: 0, width: 320, height: 240 }),
  ])));

  const result = run([
    "detail-coverage", imagePath, "--regions", inventoryPath,
    "--out", path.join(TMP, "background-mask.png"), "--ci",
  ], { allowFailure: true });

  assert.equal(result.code, 2);
  assert.match(result.stdout, /Нет ни одного отдельного смыслового элемента/);
  assert.match(result.stdout, /СТАТУС: FAIL/);
});

test("validated element inventory passes detail coverage", () => {
  const imagePath = path.join(TMP, "semantic-reference.png");
  const inventoryPath = path.join(TMP, "semantic-inventory.json");
  writePng(imagePath, 320, 240, (image) => fillRect(image, 80, 70, 100, 50));
  fs.writeFileSync(inventoryPath, JSON.stringify(inventory([
    region("background", "background", { x: 0, y: 0, width: 320, height: 240 }),
    region("primary-action", "control", { x: 79, y: 69, width: 102, height: 52 }, { selector: "#primary-action" }),
  ])));

  const validation = run(["validate-inventory", inventoryPath, "--image", imagePath, "--mode", "pixel-parity", "--ci"]);
  assert.match(validation.stdout, /СТАТУС: PASS/);

  const coverage = run([
    "detail-coverage", imagePath, "--regions", inventoryPath,
    "--out", path.join(TMP, "semantic-mask.png"), "--ci",
  ]);
  assert.match(coverage.stdout, /СТАТУС: PASS/);
});

test("detail signal warns by default and fails only when explicitly enforced", () => {
  const imagePath = path.join(TMP, "diagnostic-reference.png");
  const inventoryPath = path.join(TMP, "diagnostic-inventory.json");
  writePng(imagePath, 320, 240, (image) => fillRect(image, 220, 150, 80, 60));
  fs.writeFileSync(inventoryPath, JSON.stringify(inventory([
    region("background", "background", { x: 0, y: 0, width: 320, height: 240 }),
    region("known-label", "text", { x: 10, y: 10, width: 40, height: 20 }),
  ])));

  const diagnostic = run([
    "detail-coverage", imagePath, "--regions", inventoryPath,
    "--out", path.join(TMP, "diagnostic-mask.png"), "--ci",
  ]);
  assert.match(diagnostic.stdout, /ДИАГНОСТИКА:/);
  assert.match(diagnostic.stdout, /СТАТУС: PASS/);

  const enforced = run([
    "detail-coverage", imagePath, "--regions", inventoryPath,
    "--out", path.join(TMP, "enforced-mask.png"), "--enforce-detail-gate", "--ci",
  ], { allowFailure: true });
  assert.equal(enforced.code, 2);
  assert.match(enforced.stdout, /СТАТУС: FAIL/);
});

test("inventory validation rejects duplicate ids, undeclared overlap, and out-of-bounds regions", () => {
  const inventoryPath = path.join(TMP, "invalid-inventory.json");
  fs.writeFileSync(inventoryPath, JSON.stringify(inventory([
    region("background", "background", { x: 0, y: 0, width: 320, height: 240 }),
    region("duplicate", "control", { x: 10, y: 10, width: 80, height: 40 }),
    region("duplicate", "text", { x: 20, y: 15, width: 80, height: 40 }),
    region("outside", "control", { x: 300, y: 220, width: 50, height: 50 }),
  ])));

  const result = run(["validate-inventory", inventoryPath, "--mode", "pixel-parity", "--ci"], { allowFailure: true });
  assert.equal(result.code, 2);
  assert.match(result.stdout, /Повторяется id региона/);
  assert.match(result.stdout, /выходит за/);
  assert.match(result.stdout, /не объявлено в overlaps/);
});

test("compare passes identical images and fails changed or differently-sized images", () => {
  const referencePath = path.join(TMP, "compare-reference.png");
  const changedPath = path.join(TMP, "compare-changed.png");
  const smallPath = path.join(TMP, "compare-small.png");
  writePng(referencePath, 320, 240, (image) => fillRect(image, 40, 40, 80, 60));
  writePng(changedPath, 320, 240, (image) => fillRect(image, 0, 0, 250, 180));
  writePng(smallPath, 300, 220, (image) => fillRect(image, 40, 40, 80, 60));

  assert.match(run(["compare", referencePath, referencePath, "--out-dir", path.join(TMP, "same"), "--ci"]).stdout, /СТАТУС: PASS/);
  assert.equal(run(["compare", referencePath, changedPath, "--out-dir", path.join(TMP, "changed"), "--ci"], { allowFailure: true }).code, 2);
  const mismatch = run(["compare", referencePath, smallPath, "--out-dir", path.join(TMP, "mismatch"), "--ci"], { allowFailure: true });
  assert.equal(mismatch.code, 2);
  assert.match(mismatch.stdout, /размеры образца и реализации не совпадают/);
});

test("adaptive scan adds detail tiles for dense image regions", () => {
  const imagePath = path.join(TMP, "dense.png");
  const outDir = path.join(TMP, "scan");
  writePng(imagePath, 640, 480, (image) => {
    for (let y = 0; y < image.height; y += 8) {
      for (let x = 0; x < image.width; x += 8) {
        if ((x / 8 + y / 8) % 2 === 0) fillRect(image, x, y, 8, 8);
      }
    }
  });
  run(["scan", imagePath, "--out-dir", outDir, "--target", "320x240", "--scale", "1"]);
  const manifest = JSON.parse(fs.readFileSync(path.join(outDir, "scan-manifest.json"), "utf8"));
  assert.ok(manifest.tiles.some((tile) => tile.level === 1));
  assert.ok(manifest.tiles.every((tile) => fs.existsSync(tile.file)));
});

test("profile records hashes, viewports, and detects later input drift", () => {
  const imagePath = path.join(TMP, "profile-reference.png");
  const inventoryPath = path.join(TMP, "profile-inventory.json");
  const profilePath = path.join(TMP, "comparison-profile.json");
  writePng(imagePath, 320, 240, (image) => fillRect(image, 80, 70, 100, 50));
  fs.writeFileSync(inventoryPath, JSON.stringify(inventory([
    region("background", "background", { x: 0, y: 0, width: 320, height: 240 }),
    region("primary-action", "control", { x: 79, y: 69, width: 102, height: 52 }),
  ])));

  run([
    "create-profile", imagePath, "--inventory", inventoryPath,
    "--mode", "pixel-parity", "--out", profilePath,
    "--viewports", "desktop:320x240,mobile:390x844",
  ]);
  assert.match(run(["validate-profile", profilePath, "--ci"]).stdout, /СТАТУС: PASS/);
  const profile = JSON.parse(fs.readFileSync(profilePath, "utf8"));
  assert.equal(profile.viewports.length, 2);
  assert.match(profile.reference.sha256, /^[a-f0-9]{64}$/);
  assert.equal(profile.schemaVersion, "2.0");
  assert.equal(profile.capture.stabilityFrames, 2);
  assert.equal(profile.tool.contractVersion, "2.0.0");
  assert.equal(profile.tool.captureAlgorithmVersion, "2.0.0");
  assert.notEqual(profile.tool.playwright, "unknown");

  profile.tool.scriptSha256 = "0".repeat(64);
  fs.writeFileSync(profilePath, JSON.stringify(profile, null, 2));
  const scriptDrift = run(["validate-profile", profilePath, "--ci"]);
  assert.match(scriptDrift.stdout, /Изменился файл инструмента/);
  assert.match(scriptDrift.stdout, /СТАТУС: PASS/);

  fs.appendFileSync(inventoryPath, " ");
  const drift = run(["validate-profile", profilePath, "--ci"], { allowFailure: true });
  assert.equal(drift.code, 2);
  assert.match(drift.stdout, /Изменился файл inventory/);
});

test("style-parity keeps pixel differences diagnostic", () => {
  const referencePath = path.join(TMP, "style-reference.png");
  const implementationPath = path.join(TMP, "style-implementation.png");
  const inventoryPath = path.join(TMP, "style-inventory.json");
  const profilePath = path.join(TMP, "style-profile.json");
  writePng(referencePath, 320, 240, (image) => fillRect(image, 80, 70, 100, 50));
  writePng(implementationPath, 320, 240, (image) => fillRect(image, 0, 0, 320, 240, [20, 20, 20]));
  fs.writeFileSync(inventoryPath, JSON.stringify(inventory([
    region("background", "background", { x: 0, y: 0, width: 320, height: 240 }),
    region("concept-action", "control", { x: 79, y: 69, width: 102, height: 52 }),
  ])));
  run([
    "create-profile", referencePath, "--inventory", inventoryPath,
    "--mode", "style-parity", "--out", profilePath,
  ]);

  const result = run([
    "compare", referencePath, implementationPath,
    "--regions", inventoryPath, "--profile", profilePath,
    "--out-dir", path.join(TMP, "style-comparison"), "--ci",
  ]);
  assert.match(result.stdout, /пиксельные значения диагностические/);
  assert.match(result.stdout, /СТАТУС: PASS/);
  const report = JSON.parse(fs.readFileSync(path.join(TMP, "style-comparison/report.json"), "utf8"));
  assert.equal(report.options.pixelGateEnforced, false);
  assert.ok(report.totalPercent > 50);
});

test("browser audit passes accessible fixture and rejects inaccessible fixture", async (t) => {
  if (!fs.existsSync(chromium.executablePath())) {
    t.skip("Chromium is not installed in this environment");
    return;
  }
  const goodPath = path.join(TMP, "accessible.html");
  const badPath = path.join(TMP, "inaccessible.html");
  fs.writeFileSync(goodPath, `<!doctype html><html lang="ru"><head><style>
    body { background: #fff; color: #111; font: 16px Arial; }
    button { width: 120px; height: 44px; }
    button:focus { outline: 3px solid #005fcc; }
  </style></head><body><h1>Экран</h1><button id="action">Продолжить</button></body></html>`);
  fs.writeFileSync(badPath, `<!doctype html><html><head><style>
    body { background: #fff; color: #eee; }
    button { width: 10px; height: 10px; outline: none; color: #eee; background: #fff; }
  </style></head><body><button id="bad" aria-label=""></button></body></html>`);

  const good = await execFileAsync(process.execPath, [
    TOOL, "audit", pathToFileURL(goodPath).href, "--viewport", "320x240",
    "--wait-ms", "0", "--out", path.join(TMP, "good-audit.json"), "--ci",
  ], { cwd: ROOT, encoding: "utf8" });
  assert.match(good.stdout, /СТАТУС: PASS/);

  const capturePath = path.join(TMP, "stable-capture.png");
  await execFileAsync(process.execPath, [
    TOOL, "capture", pathToFileURL(goodPath).href, "--out", capturePath,
    "--viewport", "320x240", "--wait-ms", "0", "--max-stability-attempts", "3",
  ], { cwd: ROOT, encoding: "utf8" });
  const captureReport = JSON.parse(fs.readFileSync(`${capturePath}.json`, "utf8"));
  assert.equal(captureReport.stability.stable, true);
  assert.ok(captureReport.stability.attempts >= 2);

  await assert.rejects(
    execFileAsync(process.execPath, [
      TOOL, "audit", pathToFileURL(badPath).href, "--viewport", "320x240",
      "--wait-ms", "0", "--out", path.join(TMP, "bad-audit.json"), "--ci",
    ], { cwd: ROOT, encoding: "utf8" }),
    (error) => error.code === 2 && /СТАТУС: FAIL/.test(error.stdout)
  );
});
