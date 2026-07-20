/**
 * Browser proof for the first Cards Money Trains operating turn on real data.
 *
 * The author has confirmed the normal team setup, placement procedure, initial
 * road states and deck lifecycle. The normative game still remains
 * `runtimeReady: false` until those rules are implemented end to end and the
 * author visually confirms the extracted network geometry. These tests
 * materialize an isolated preview copy under `.tmp/editor-worktrees`, which is
 * the existing trusted editor-preview boundary. The browser still uses the
 * ordinary Player Web BFF, HttpOnly session credential, immutable runtime
 * bundle, map-first UI and production Mechanics dispatcher.
 */

import { createHash, randomUUID } from "node:crypto";
import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import path from "node:path";
import {
  expect,
  test,
  type Page
} from "@playwright/test";

const GAME_ID = "cards-money-trains";
const BOARD_LABEL =
  "Транспортная карта игры. Все доступные действия дублируются обычными кнопками под полем.";
const RUNTIME_URL = process.env.E2E_RUNTIME_URL ?? "http://127.0.0.1:3201";
const REPO_ROOT = process.cwd();
const SOURCE_GAME_ROOT = path.join(REPO_ROOT, "games", GAME_ID);
const PREVIEW_ROOT = path.join(REPO_ROOT, ".tmp", "editor-worktrees");

type BranchName = "positive" | "negative";
type JsonRecord = Record<string, unknown>;

interface TechnicalStep {
  readonly actionId: string;
  readonly params?: JsonRecord;
  readonly expect: "applied" | "rejected";
}

interface TechnicalFixture {
  readonly fixtureId: string;
  readonly publishable: false;
  readonly objects: JsonRecord;
  readonly branches: Record<BranchName, {
    readonly newsId: string;
    readonly steps: readonly TechnicalStep[];
    readonly expected: JsonRecord;
  }>;
}

interface PublishedPluginBundle {
  readonly pluginId: string;
  readonly gameId: string;
  readonly apiVersion: string;
  readonly target: "player-web";
  readonly scope: "published";
  readonly contentHash: string;
  readonly filePath: string;
}

interface RuntimeSnapshot {
  readonly sessionId: string;
  readonly version: {
    readonly stateVersion: number;
  };
  readonly receipt?: {
    readonly status: "applied" | "rejected";
    readonly rejectionCode?: string;
  };
  readonly state: {
    readonly secret?: {
      readonly decks?: unknown;
    };
    readonly public: {
      readonly session: {
        readonly phase: string;
      };
      readonly teams: Record<string, {
        readonly coins: number;
      }>;
      readonly objects: {
        readonly networkEdges: Record<string, {
          readonly facets: {
            readonly state: string;
          };
        }>;
        readonly locomotives: Record<string, {
          readonly attributes: {
            readonly nodeId: string;
            readonly actionPoints: number;
          };
        }>;
        readonly wagons: Record<string, {
          readonly attributes: {
            readonly nodeId: string;
            readonly cargoId: string | null;
            readonly attachedVehicleId: string | null;
          };
        }>;
        readonly cargoOrders: Record<string, {
          readonly facets: {
            readonly status: string;
          };
          readonly attributes: {
            readonly settledRouteLength: number | null;
          };
        }>;
      };
    };
  };
}

interface PreviewSource {
  readonly branch: BranchName;
  readonly contentRoot: string;
  readonly contentSourceId: string;
  readonly pluginBundles: readonly [{
    readonly pluginId: string;
    readonly gameId: string;
    readonly apiVersion: string;
    readonly target: "player-web";
    readonly scope: "preview";
    readonly contentHash: string;
    readonly filePath: string;
  }];
}

const temporaryRoots = new Set<string>();

test.afterAll(() => {
  for (const root of temporaryRoots) {
    rmSync(root, { recursive: true, force: true });
  }
});

test.describe("Cards Money Trains real operating-turn preview", () => {
  test("runs news 24, cargo 1 to 9 and settlement through the facilitator map", async ({ page }) => {
    test.setTimeout(120_000);
    const source = materializePreviewSource("positive");
    const initial = await openPreviewSession(page, source);
    const board = page.getByRole("region", { name: BOARD_LABEL });

    await expectMapFirstSurface(board);
    expectNoSecretDecks(initial);

    let snapshot = initial;
    snapshot = await clickBoardAction(page, board, "Технический replay: применить новость № 24");
    expect(snapshot.receipt?.status).toBe("applied");
    expect(snapshot.state.public.session.phase).toBe("cargo");

    snapshot = await clickBoardAction(page, board, "Технический replay: загрузить груз");
    expect(snapshot.receipt?.status).toBe("applied");
    expect(snapshot.state.public.session.phase).toBe("operations");

    snapshot = await clickBoardAction(page, board, "Технический replay: прицепить вагон");
    expect(snapshot.receipt?.status).toBe("applied");
    snapshot = await clickBoardAction(page, board, "Технический replay: перейти по дороге");
    expect(snapshot.receipt?.status).toBe("applied");
    snapshot = await clickBoardAction(page, board, "Технический replay: доставить груз");
    expect(snapshot.receipt?.status).toBe("applied");
    expectNoSecretDecks(snapshot);

    expect(snapshot.state.public.teams["white-logistics"]?.coins).toBe(24);
    expect(snapshot.state.public.teams["purple-guild"]?.coins).toBe(12);
    expect(
      snapshot.state.public.objects.locomotives["technical-locomotive-purple-1"]?.attributes
    ).toMatchObject({
      nodeId: "terminal-9",
      actionPoints: 3
    });
    expect(
      snapshot.state.public.objects.wagons["technical-wagon-white-1"]?.attributes
    ).toMatchObject({
      nodeId: "terminal-9",
      cargoId: null,
      attachedVehicleId: null
    });
    expect(
      snapshot.state.public.objects.cargoOrders["cargo-source-row-005"]
    ).toMatchObject({
      facets: { status: "delivered" },
      attributes: { settledRouteLength: 1 }
    });

    const restored = page.waitForResponse((response) =>
      response.url().includes(`/api/runtime/sessions/${snapshot.sessionId}`) &&
      response.request().method() === "GET"
    );
    await page.reload();
    const restoredSnapshot = await responseJson<RuntimeSnapshot>(await restored);
    expect(restoredSnapshot.version.stateVersion).toBe(snapshot.version.stateVersion);
    expect(
      restoredSnapshot.state.public.objects.locomotives["technical-locomotive-purple-1"]
        ?.attributes.nodeId
    ).toBe("terminal-9");
    await expectMapFirstSurface(page.getByRole("region", { name: BOARD_LABEL }));
  });

  test("shows news 11 blocking and rejects movement without partial state", async ({ page }) => {
    test.setTimeout(120_000);
    const source = materializePreviewSource("negative");
    let snapshot = await openPreviewSession(page, source);
    const board = page.getByRole("region", { name: BOARD_LABEL });

    await expectMapFirstSurface(board);
    snapshot = await clickBoardAction(page, board, "Технический replay: применить новость № 11");
    expect(snapshot.receipt?.status).toBe("applied");
    expect(
      snapshot.state.public.objects.networkEdges["road-1-9"]?.facets.state
    ).toBe("blocked");

    const beforeVersion = snapshot.version.stateVersion;
    const beforeLocomotive =
      snapshot.state.public.objects.locomotives["technical-locomotive-purple-1"]?.attributes;
    const rejectedResponse = page.waitForResponse((response) =>
      response.url().endsWith("/api/runtime/actions") &&
      response.request().method() === "POST" &&
      response.request().postDataJSON()?.actionId === "technical.operations.move"
    );
    await board.getByRole("button", {
      name: "Технический replay: перейти по дороге"
    }).click();
    const rejected = await responseJson<RuntimeSnapshot>(await rejectedResponse);

    expect(rejected.receipt?.status).toBe("rejected");
    expect(rejected.version.stateVersion).toBe(beforeVersion);
    expect(
      rejected.state.public.objects.locomotives["technical-locomotive-purple-1"]?.attributes
    ).toEqual(beforeLocomotive);
    expect(
      rejected.state.public.objects.networkEdges["road-1-9"]?.facets.state
    ).toBe("blocked");
    expectNoSecretDecks(rejected);
    await expect(board.getByRole("alert")).toBeVisible();
  });
});

/**
 * Build a launchable copy without changing the normative package on disk.
 *
 * Only the preview clone receives runtimeReady=true. The technical action
 * plans still require the fixture id, so even this local source cannot execute
 * them against an ordinary initial state.
 */
function materializePreviewSource(branchName: BranchName): PreviewSource {
  const sourceManifest = readJson<JsonRecord>(
    path.join(SOURCE_GAME_ROOT, "game.manifest.json")
  );
  const fixture = readJson<TechnicalFixture>(
    path.join(SOURCE_GAME_ROOT, "authoring", "fixtures", "real-operating-turn.technical.json")
  );
  const pluginMetadata = readJson<{ readonly bundles: readonly PublishedPluginBundle[] }>(
    path.join(SOURCE_GAME_ROOT, "published", "player-web-plugin-bundles.json")
  );

  const config = requireRecord(sourceManifest.config, "manifest.config");
  if (config.runtimeReady !== false) {
    throw new Error("Normative Cards Money Trains unexpectedly became runtime-ready.");
  }
  if (fixture.publishable !== false) {
    throw new Error("The technical real-data fixture must remain nonpublishable.");
  }

  const branch = fixture.branches[branchName];
  const previewManifest = structuredClone(sourceManifest);
  const previewConfig = requireRecord(previewManifest.config, "preview.config");
  previewConfig.runtimeReady = true;
  // The manifest schema permits either a meaningful non-empty blocker list or
  // no list. This isolated preview has substituted every listed prerequisite,
  // so removing the field is more truthful than inventing a placeholder.
  delete previewConfig.runtimeBlockers;

  const previewState = requireRecord(previewManifest.state, "preview.state");
  const publicState = requireRecord(previewState.public, "preview.state.public");
  const session = requireRecord(publicState.session, "preview.state.public.session");
  const news = requireRecord(publicState.news, "preview.state.public.news");
  const board = requireRecord(publicState.board, "preview.state.public.board");
  const actions = requireRecord(previewManifest.actions, "preview.actions");

  session.fixtureId = fixture.fixtureId;
  session.phase = "news";
  news.currentCardId = branch.newsId;
  publicState.objects = structuredClone(fixture.objects);
  board.highlights = [];
  board.availableActions = branch.steps.map((step, index) => {
    const definition = requireRecord(actions[step.actionId], `preview.actions.${step.actionId}`);
    if (typeof definition.displayName !== "string") {
      throw new Error(`Action "${step.actionId}" has no displayName for the accessible UI.`);
    }
    return {
      id: `technical-review-${branchName}-${index + 1}`,
      label: definition.displayName,
      actionId: step.actionId,
      ...(step.params === undefined ? {} : { params: structuredClone(step.params) })
    };
  });

  const contentSourceId =
    `cmt-real-${branchName}-${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const contentRoot = path.join(PREVIEW_ROOT, contentSourceId);
  const targetGameRoot = path.join(contentRoot, "games", GAME_ID);
  const targetUiRoot = path.join(targetGameRoot, "ui", "web");
  const targetBundleRoot = path.join(contentRoot, "preview-plugin-bundles");
  mkdirSync(targetUiRoot, { recursive: true });
  mkdirSync(targetBundleRoot, { recursive: true });
  temporaryRoots.add(contentRoot);

  writeFileSync(
    path.join(targetGameRoot, "game.manifest.json"),
    `${JSON.stringify(previewManifest, null, 2)}\n`,
    "utf8"
  );
  copyFileSync(
    path.join(SOURCE_GAME_ROOT, "ui", "web", "ui.manifest.json"),
    path.join(targetUiRoot, "ui.manifest.json")
  );

  const publishedBundle = pluginMetadata.bundles.find((candidate) =>
    candidate.gameId === GAME_ID &&
    candidate.target === "player-web" &&
    candidate.scope === "published"
  );
  if (!publishedBundle) {
    throw new Error("Published Cards Money Trains player plugin bundle was not found.");
  }
  const sourceBundlePath = path.join(SOURCE_GAME_ROOT, publishedBundle.filePath);
  const sourceBytes = readFileSync(sourceBundlePath);
  const actualHash = createHash("sha256").update(sourceBytes).digest("hex");
  if (actualHash !== publishedBundle.contentHash) {
    throw new Error("Published Cards Money Trains player plugin bundle is stale.");
  }
  const targetBundlePath = path.join(
    targetBundleRoot,
    `${publishedBundle.pluginId}.${publishedBundle.contentHash}.mjs`
  );
  copyFileSync(sourceBundlePath, targetBundlePath);

  return {
    branch: branchName,
    contentRoot,
    contentSourceId,
    pluginBundles: [{
      pluginId: publishedBundle.pluginId,
      gameId: publishedBundle.gameId,
      apiVersion: publishedBundle.apiVersion,
      target: "player-web",
      scope: "preview",
      contentHash: publishedBundle.contentHash,
      filePath: toPosixPath(path.relative(contentRoot, targetBundlePath))
    }]
  };
}

/** Register one isolated source and open its session through the browser BFF. */
async function openPreviewSession(
  page: Page,
  source: PreviewSource
): Promise<RuntimeSnapshot> {
  const reload = await page.request.post(`${RUNTIME_URL}/content/reload`, {
    data: {
      gameId: GAME_ID,
      contentSourceId: source.contentSourceId,
      contentRoot: source.contentRoot,
      pluginBundles: source.pluginBundles
    }
  });
  expect(reload.status(), await reload.text()).toBe(200);

  // Creating through Player Web stores the runtime credential in a same-origin
  // HttpOnly cookie. The browser sees only the safe session projection.
  const create = await page.request.post("/api/runtime/sessions", {
    data: {
      gameId: GAME_ID,
      contentSourceId: source.contentSourceId
    }
  });
  const snapshot = await responseJson<RuntimeSnapshot>(create, 201);
  expect(snapshot.version.stateVersion).toBe(0);

  const mapAsset = page.waitForResponse((response) =>
    response.url().includes(`/game-assets/${GAME_ID}/board-guinea-optimized/`) &&
    response.url().endsWith(".webp")
  );
  await page.goto(
    `/?gameId=${GAME_ID}&preview=1&sessionId=${encodeURIComponent(snapshot.sessionId)}` +
    `&contentSourceId=${encodeURIComponent(source.contentSourceId)}`
  );
  expect((await mapAsset).status()).toBe(200);

  await expect(page.locator(".game-player-root")).toBeVisible();
  await expect(page.locator(".loading-state")).toHaveCount(0);
  await expect(page.getByRole("heading", {
    name: "Карты, деньги, поезда",
    level: 1
  })).toBeVisible();
  return snapshot;
}

/** Dispatch one fixed technical intent through its ordinary keyboard button. */
async function clickBoardAction(
  page: Page,
  board: ReturnType<Page["locator"]>,
  label: string
): Promise<RuntimeSnapshot> {
  const actionButton = board.getByRole("button", { name: label });
  await expect(actionButton).toBeVisible();
  await expect(actionButton).toBeEnabled();
  const response = page.waitForResponse((candidate) =>
    candidate.url().endsWith("/api/runtime/actions") &&
    candidate.request().method() === "POST" &&
    candidate.request().postDataJSON()?.actionId === actionIdForLabel(label)
  );
  await actionButton.click();
  const actionResponse = await response;
  const serverTiming = actionResponse.headers()["server-timing"];
  expect(serverTiming).toContain("dispatch;dur=");
  expect(serverTiming).toContain("action-availability;dur=");
  expect(serverTiming).toContain("total;dur=");
  const snapshot = await responseJson<RuntimeSnapshot>(actionResponse);
  const canvasHost = board.getByTestId("interactive-board-canvas-host");
  // These browser-local diagnostics prove that the measured round trip and
  // synchronous scene application are observable without changing gameplay
  // state or sending telemetry to another service.
  await expect(canvasHost).toHaveAttribute("data-last-action-round-trip-ms", /^\d+\.\d{3}$/u);
  await expect(canvasHost).toHaveAttribute("data-last-scene-apply-ms", /^\d+\.\d{3}$/u);
  expectNoSecretDecks(snapshot);
  return snapshot;
}

/** Keep request matching explicit so one click cannot satisfy another step. */
function actionIdForLabel(label: string): string {
  const byLabel: Record<string, string> = {
    "Технический replay: применить новость № 24": "technical.news.apply.24",
    "Технический replay: применить новость № 11": "technical.news.apply.11",
    "Технический replay: загрузить груз": "technical.cargo.load",
    "Технический replay: прицепить вагон": "technical.operations.attach",
    "Технический replay: перейти по дороге": "technical.operations.move",
    "Технический replay: доставить груз": "technical.cargo.deliver"
  };
  const actionId = byLabel[label];
  if (!actionId) throw new Error(`Unknown technical browser action label: ${label}`);
  return actionId;
}

async function expectMapFirstSurface(
  board: ReturnType<Page["locator"]>
): Promise<void> {
  await expect(board).toHaveAttribute("data-layout-mode", "map-first");
  const canvasHost = board.getByTestId("interactive-board-canvas-host");
  await expect(canvasHost).toBeVisible();
  await expect(canvasHost).toHaveAttribute("data-phaser-renderer", /^(webgl|canvas)$/u);
  await expect(board.getByRole("button", { name: "Увеличить карту" })).toBeVisible();
  await expect(board.getByRole("button", { name: "Уменьшить карту" })).toBeVisible();
  await expect(board.getByRole("button", { name: "Показать всю карту" })).toBeVisible();
}

function expectNoSecretDecks(snapshot: RuntimeSnapshot): void {
  expect(snapshot.state.secret?.decks).toBeUndefined();
}

async function responseJson<T>(
  response: { readonly text: () => Promise<string>; readonly status: () => number },
  expectedStatus = 200
): Promise<T> {
  const text = await response.text();
  expect(response.status(), text).toBe(expectedStatus);
  return JSON.parse(text) as T;
}

function readJson<T>(absolutePath: string): T {
  return JSON.parse(readFileSync(absolutePath, "utf8")) as T;
}

function requireRecord(value: unknown, label: string): JsonRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as JsonRecord;
}

function toPosixPath(value: string): string {
  return value.split(path.sep).join("/");
}
