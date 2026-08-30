/** Integration tests for ADR-063 registry, hashing, path safety and HTTP delivery. */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, symlink, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

import { ContentService, type GameAssetIndex } from "../src/modules/content/contentService.ts";
import { LocalFileGameRepository } from "../src/modules/content/localFileRepository.ts";
import { createRuntimeApiServer } from "../src/modules/player-api/httpServer.ts";
import { InMemorySessionStore } from "../src/modules/session/inMemorySessionStore.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const fixtureRoot = path.join(repoRoot, ".tmp", "game-assets-runtime-test");
const gameId = "test-game";
const assetsRoot = path.join(fixtureRoot, "games", gameId, "assets");
const publishedRoot = path.join(fixtureRoot, "games", gameId, "published");
const svgPath = path.join(assetsRoot, "board.svg");
// ADR-091 published stylesheet fixture: already token-rewritten CSS plus its
// content-addressable metadata index, hand-written here so the runtime-api
// indexing/serving contract is exercised without invoking the publish script.
const stylesheetCss = ".info-main-content h1{color:#0b7285}\n";
const stylesheetHash = createHash("sha256").update(stylesheetCss, "utf8").digest("hex");
const stylesheetIntegrity = `sha256-${createHash("sha256").update(stylesheetCss, "utf8").digest("base64")}`;
const stylesheetFileName = `theme.${stylesheetHash}.css`;
const repository = new LocalFileGameRepository(fixtureRoot);
const assetContentService = new ContentService(repository);
const runtimeApi = createRuntimeApiServer({
  port: 0,
  assetContentService,
  sessionStore: new InMemorySessionStore<Record<string, unknown>>()
});
let baseUrl = "";

before(async () => {
  await rm(fixtureRoot, { recursive: true, force: true });
  await mkdir(assetsRoot, { recursive: true });
  await writeFile(svgPath, '<svg viewBox="0 0 10 10"><path d="M0 0h10v10z"/></svg>');
  await writeFile(path.join(assetsRoot, "token.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  await writeFile(path.join(assetsRoot, "assets.json"), JSON.stringify({
    gameId,
    assets: [
      { id: "board", file: "board.svg", kind: "image", origin: { type: "authored-in-repo" } },
      { id: "token", file: "token.png", kind: "image", origin: { type: "authored-in-repo" } }
    ],
    stylesheets: [
      { id: "theme", file: "styles/theme.css", kind: "css", origin: { type: "authored-in-repo" } }
    ]
  }));
  await mkdir(publishedRoot, { recursive: true });
  await writeFile(path.join(publishedRoot, stylesheetFileName), stylesheetCss);
  await writeFile(path.join(publishedRoot, "game-stylesheets.json"), JSON.stringify({
    schemaVersion: "1.0",
    stylesheets: [
      {
        stylesheetId: "theme",
        gameId,
        contentHash: stylesheetHash,
        integrity: stylesheetIntegrity,
        filePath: `published/${stylesheetFileName}`,
        url: `/game-stylesheets/${gameId}/theme/${stylesheetHash}.css`
      }
    ]
  }));
  await runtimeApi.start();
  baseUrl = `http://127.0.0.1:${runtimeApi.port}`;
});

after(async () => {
  await runtimeApi.close();
  await rm(fixtureRoot, { recursive: true, force: true });
});

test("GET asset index is stable and uses content-addressed URLs", async () => {
  const firstResponse = await fetch(`${baseUrl}/game-assets/${gameId}/index.json`);
  const first = await firstResponse.json() as GameAssetIndex;
  const second = await (await fetch(`${baseUrl}/game-assets/${gameId}/index.json`)).json() as GameAssetIndex;

  assert.equal(firstResponse.status, 200);
  assert.equal(firstResponse.headers.get("cache-control"), "no-cache");
  assert.equal(firstResponse.headers.get("access-control-allow-origin"), "*");
  assert.deepEqual(first, second);
  assert.match(first.assets.board.url, /^\/game-assets\/test-game\/board\/[a-f0-9]{64}\.svg$/u);
});

test("serves verified SVG and raster bytes with required immutable headers", async () => {
  const index = await (await fetch(`${baseUrl}/game-assets/${gameId}/index.json`)).json() as GameAssetIndex;
  const svgResponse = await fetch(`${baseUrl}${index.assets.board.url}`);
  const pngResponse = await fetch(`${baseUrl}${index.assets.token.url}`);

  assert.equal(svgResponse.status, 200);
  assert.equal(svgResponse.headers.get("content-type"), "image/svg+xml");
  assert.equal(svgResponse.headers.get("cache-control"), "public, max-age=31536000, immutable");
  assert.equal(svgResponse.headers.get("x-content-type-options"), "nosniff");
  assert.equal(svgResponse.headers.get("content-security-policy"), "default-src 'none'; style-src 'unsafe-inline'");
  assert.equal(await svgResponse.text(), await readFile(svgPath, "utf8"));

  assert.equal(pngResponse.status, 200);
  assert.equal(pngResponse.headers.get("content-type"), "image/png");
  assert.equal(pngResponse.headers.get("content-security-policy"), null);
});

test("returns uniform 404 for unknown ids, hashes, extensions and invalid path ids", async () => {
  const index = await (await fetch(`${baseUrl}/game-assets/${gameId}/index.json`)).json() as GameAssetIndex;
  const boardUrl = index.assets.board.url;
  const unknownId = boardUrl.replace("/board/", "/missing/");
  const wrongHash = boardUrl.replace(/[a-f0-9]{64}/u, "0".repeat(64));
  const wrongExtension = boardUrl.replace(/\.svg$/u, ".png");

  for (const url of [
    unknownId,
    wrongHash,
    wrongExtension,
    "/game-assets/INVALID/index.json",
    `/game-assets/${gameId}/bad_id/${"0".repeat(64)}.svg`,
    "/game-assets/missing-game/index.json"
  ]) {
    assert.equal((await fetch(`${baseUrl}${url}`)).status, 404, url);
  }
});

test("invalidates the SHA-256 cache when file mtime changes", async () => {
  const before = await assetContentService.getGameAssetIndex(gameId);
  await writeFile(svgPath, '<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>');
  const future = new Date(Date.now() + 2000);
  await utimes(svgPath, future, future);
  const afterChange = await assetContentService.getGameAssetIndex(gameId);

  assert.notEqual(before.assets.board.url, afterChange.assets.board.url);
  assert.equal((await fetch(`${baseUrl}${before.assets.board.url}`)).status, 404);
  assert.equal((await fetch(`${baseUrl}${afterChange.assets.board.url}`)).status, 200);
});

test("asset index unifies images and game-owned stylesheets under one namespace (ADR-091)", async () => {
  const index = await (await fetch(`${baseUrl}/game-assets/${gameId}/index.json`)).json() as GameAssetIndex;

  assert.equal(index.assets.board.kind, "image");
  assert.equal(index.assets.theme.kind, "css");
  assert.equal(index.assets.theme.url, `/game-stylesheets/${gameId}/theme/${stylesheetHash}.css`);
});

test("serves published stylesheet as text/css with an immutable cache", async () => {
  const response = await fetch(`${baseUrl}/game-stylesheets/${gameId}/theme/${stylesheetHash}.css`);

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "text/css; charset=utf-8");
  assert.equal(response.headers.get("cache-control"), "public, max-age=31536000, immutable");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(await response.text(), stylesheetCss);
});

test("stylesheet route returns 404 for unknown id and wrong hash", async () => {
  const wrongHash = `/game-stylesheets/${gameId}/theme/${"0".repeat(64)}.css`;
  const unknownId = `/game-stylesheets/${gameId}/missing/${stylesheetHash}.css`;

  assert.equal((await fetch(`${baseUrl}${wrongHash}`)).status, 404);
  assert.equal((await fetch(`${baseUrl}${unknownId}`)).status, 404);
});

test("repository rejects lexical traversal and symlink escapes", async () => {
  await assert.rejects(() => repository.getGameAssetFileMetadata(gameId, "../secret.svg"), /safe relative path/u);
  await assert.rejects(() => repository.getGameAssetFileMetadata(gameId, path.resolve(fixtureRoot, "secret.svg")), /safe relative path/u);

  const secretPath = path.join(fixtureRoot, "secret.svg");
  await writeFile(secretPath, '<svg viewBox="0 0 1 1"></svg>');
  await symlink(secretPath, path.join(assetsRoot, "escape.svg"));
  await assert.rejects(() => repository.getGameAssetFileMetadata(gameId, "escape.svg"), /symbolic link/u);
});
