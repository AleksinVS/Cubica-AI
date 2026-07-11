/** Integration tests for ADR-063 registry, hashing, path safety and HTTP delivery. */

import assert from "node:assert/strict";
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
const svgPath = path.join(assetsRoot, "board.svg");
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

test("repository rejects lexical traversal and symlink escapes", async () => {
  await assert.rejects(() => repository.getGameAssetFileMetadata(gameId, "../secret.svg"), /safe relative path/u);
  await assert.rejects(() => repository.getGameAssetFileMetadata(gameId, path.resolve(fixtureRoot, "secret.svg")), /safe relative path/u);

  const secretPath = path.join(fixtureRoot, "secret.svg");
  await writeFile(secretPath, '<svg viewBox="0 0 1 1"></svg>');
  await symlink(secretPath, path.join(assetsRoot, "escape.svg"));
  await assert.rejects(() => repository.getGameAssetFileMetadata(gameId, "escape.svg"), /symbolic link/u);
});
