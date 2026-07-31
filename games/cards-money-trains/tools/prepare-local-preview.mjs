#!/usr/bin/env node
/**
 * Prepare a launchable local preview of the real Cards Money Trains package.
 *
 * The normative package must remain `runtimeReady: false` until its visual
 * content gates close. This tool clones it under the already trusted
 * `.tmp/editor-worktrees` preview boundary, removes blockers only from that
 * disposable copy, and registers its immutable player bundle with runtime-api.
 * It never writes to the real manifest or converts mock content into game data.
 */

import { createHash } from "node:crypto";
import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  writeFileSync
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TOOL_ROOT = path.dirname(fileURLToPath(import.meta.url));
const GAME_ROOT = path.resolve(TOOL_ROOT, "..");
const REPO_ROOT = path.resolve(GAME_ROOT, "..", "..");
const GAME_ID = "cards-money-trains";
const PREVIEW_ROOT = path.join(REPO_ROOT, ".tmp", "editor-worktrees");

const options = parseArgs(process.argv.slice(2));
const sourceManifestPath = path.join(GAME_ROOT, "game.manifest.json");
const sourceUiPath = path.join(GAME_ROOT, "ui", "web", "ui.manifest.json");
const sourceMetadataPath = path.join(
  GAME_ROOT,
  "published",
  "player-web-plugin-bundles.json"
);
const sourceManifestBytes = readFileSync(sourceManifestPath);
const sourceManifest = JSON.parse(sourceManifestBytes.toString("utf8"));
const sourceMetadata = JSON.parse(readFileSync(sourceMetadataPath, "utf8"));

if (sourceManifest?.config?.runtimeReady !== false) {
  throw new Error("Normative Cards Money Trains unexpectedly became runtime-ready.");
}

const publishedBundle = sourceMetadata?.bundles?.find((candidate) =>
  candidate?.gameId === GAME_ID
  && candidate?.target === "player-web"
  && candidate?.scope === "published"
);
if (!publishedBundle) {
  throw new Error("Published Cards Money Trains player bundle was not found.");
}

const sourceBundlePath = path.join(GAME_ROOT, publishedBundle.filePath);
const sourceBundleBytes = readFileSync(sourceBundlePath);
const actualBundleHash = sha256(sourceBundleBytes);
if (actualBundleHash !== publishedBundle.contentHash) {
  throw new Error(
    "Published player bundle is stale. Run the focused player bundle builder first."
  );
}

const previewKey = sha256(Buffer.concat([
  sourceManifestBytes,
  sourceBundleBytes
])).slice(0, 16);
const contentSourceId = `cmt-real-visual-${previewKey}`;
const contentRoot = path.join(PREVIEW_ROOT, contentSourceId);
const targetGameRoot = path.join(contentRoot, "games", GAME_ID);
const targetUiRoot = path.join(targetGameRoot, "ui", "web");
const targetBundleRoot = path.join(contentRoot, "preview-plugin-bundles");
mkdirSync(targetUiRoot, { recursive: true });
mkdirSync(targetBundleRoot, { recursive: true });

const previewManifest = structuredClone(sourceManifest);
previewManifest.config.runtimeReady = true;
delete previewManifest.config.runtimeBlockers;
writeFileSync(
  path.join(targetGameRoot, "game.manifest.json"),
  `${JSON.stringify(previewManifest, null, 2)}\n`,
  "utf8"
);
copyFileSync(sourceUiPath, path.join(targetUiRoot, "ui.manifest.json"));

const targetBundlePath = path.join(
  targetBundleRoot,
  `${publishedBundle.pluginId}.${publishedBundle.contentHash}.mjs`
);
copyFileSync(sourceBundlePath, targetBundlePath);
const pluginBundles = [{
  pluginId: publishedBundle.pluginId,
  gameId: publishedBundle.gameId,
  apiVersion: publishedBundle.apiVersion,
  target: "player-web",
  scope: "preview",
  contentHash: publishedBundle.contentHash,
  filePath: toPosixPath(path.relative(contentRoot, targetBundlePath))
}];

if (!options.noRegister) {
  const response = await fetch(new URL("/content/reload", options.runtimeUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      gameId: GAME_ID,
      contentSourceId,
      contentRoot,
      pluginBundles
    })
  });
  if (!response.ok) {
    throw new Error(
      `runtime-api rejected preview registration (${response.status}): ${await response.text()}`
    );
  }
}

console.log(JSON.stringify({
  gameId: GAME_ID,
  contentSourceId,
  contentRoot,
  runtimeUrl: options.runtimeUrl.toString().replace(/\/$/u, ""),
  registered: !options.noRegister,
  createSessionRequest: {
    method: "POST",
    playerPath: "/api/runtime/sessions",
    body: {
      gameId: GAME_ID,
      contentSourceId
    }
  },
  previewRouteTemplate:
    `/?gameId=${GAME_ID}&preview=1&sessionId=<SESSION_ID>`
    + `&contentSourceId=${encodeURIComponent(contentSourceId)}`
}, null, 2));

if (options.open) {
  await openPreviewBrowser({
    playerUrl: options.playerUrl,
    contentSourceId
  });
}

function parseArgs(args) {
  let runtimeUrl = process.env.RUNTIME_API_URL ?? "http://127.0.0.1:3001";
  let playerUrl = process.env.PLAYER_WEB_URL ?? "http://127.0.0.1:3000";
  let noRegister = false;
  let open = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--runtime-url") {
      runtimeUrl = args[index + 1];
      if (!runtimeUrl) throw new Error("--runtime-url requires a URL.");
      index += 1;
    } else if (argument === "--no-register") {
      noRegister = true;
    } else if (argument === "--player-url") {
      playerUrl = args[index + 1];
      if (!playerUrl) throw new Error("--player-url requires a URL.");
      index += 1;
    } else if (argument === "--open") {
      open = true;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  const parsedRuntimeUrl = new URL(runtimeUrl);
  const parsedPlayerUrl = new URL(playerUrl);
  if (!["http:", "https:"].includes(parsedRuntimeUrl.protocol)) {
    throw new Error("--runtime-url must use http or https.");
  }
  if (!["http:", "https:"].includes(parsedPlayerUrl.protocol)) {
    throw new Error("--player-url must use http or https.");
  }
  if (open && noRegister) {
    throw new Error("--open cannot be combined with --no-register.");
  }
  return {
    runtimeUrl: parsedRuntimeUrl,
    playerUrl: parsedPlayerUrl,
    noRegister,
    open
  };
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function toPosixPath(value) {
  return value.split(path.sep).join("/");
}

/**
 * Create the preview session inside the same browser origin that will use it.
 *
 * Player Web keeps the runtime credential in an HttpOnly cookie. Creating the
 * session through page JavaScript is therefore safer than printing a token or
 * adding a permanent preview-launch route to the shared application.
 */
async function openPreviewBrowser({ playerUrl, contentSourceId }) {
  const { chromium } = await import("playwright");
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  const browser = await chromium.launch({
    headless: false,
    ...(executablePath ? { executablePath } : {}),
    args: ["--no-sandbox"]
  });
  const close = async () => {
    if (browser.isConnected()) await browser.close();
  };
  process.once("SIGINT", () => void close());
  process.once("SIGTERM", () => void close());

  const page = await browser.newPage({ viewport: null });
  await page.goto(playerUrl.toString(), { waitUntil: "domcontentloaded" });
  const session = await page.evaluate(async ({ gameId, sourceId }) => {
    const response = await fetch("/api/runtime/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        gameId,
        contentSourceId: sourceId
      })
    });
    if (!response.ok) {
      throw new Error(`Player Web rejected preview session creation (${response.status}).`);
    }
    return response.json();
  }, { gameId: GAME_ID, sourceId: contentSourceId });
  if (typeof session?.sessionId !== "string") {
    await close();
    throw new Error("Player Web returned a preview session without sessionId.");
  }

  const previewUrl = new URL("/", playerUrl);
  previewUrl.searchParams.set("gameId", GAME_ID);
  previewUrl.searchParams.set("preview", "1");
  previewUrl.searchParams.set("sessionId", session.sessionId);
  previewUrl.searchParams.set("contentSourceId", contentSourceId);
  // Playwright accepts only a string here; a URL object fails the argument
  // check and would abort the launch after the session has already been
  // created, leaving a live session with no window attached to it.
  await page.goto(previewUrl.toString(), { waitUntil: "domcontentloaded" });
  console.log(`Preview opened: ${previewUrl}`);
  console.log("Close the browser window or press Ctrl+C in this terminal to stop the preview browser.");
  await new Promise((resolve) => browser.once("disconnected", resolve));
}
