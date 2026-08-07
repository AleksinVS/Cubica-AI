/** Focused bounded-LRU regression for parsed game bundles. */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import type { CubicaMechanicsIRV1Alpha1, GameManifest } from "@cubica/contracts-manifest";

import {
  CONTENT_BUNDLE_CACHE_MAX_ENTRIES,
  ContentService
} from "../src/modules/content/contentService.ts";
import type {
  GameAssetFileMetadata,
  IGameRepository
} from "../src/modules/content/repository.ts";

const require = createRequire(import.meta.url);
const { recommendedModuleLock } = require("../../../scripts/manifest-tools/mechanics-modules.cjs") as {
  recommendedModuleLock: (moduleIds: Array<string>) => CubicaMechanicsIRV1Alpha1["moduleLock"];
};
const { mechanicsSha256 } = require("../../../scripts/manifest-tools/mechanics-canonicalize.cjs") as {
  mechanicsSha256: (value: unknown) => string;
};

test("parsed bundles are bounded and cache hits refresh least-recently-used order", async () => {
  const template = JSON.parse(await readFile(
    new URL("../../../games/simple-choice/game.manifest.json", import.meta.url),
    "utf8"
  )) as Record<string, unknown>;
  const repository = new CountingManifestRepository(template);
  const service = new ContentService(repository);
  const gameIds = Array.from(
    { length: CONTENT_BUNDLE_CACHE_MAX_ENTRIES + 1 },
    (_, index) => `cache-fixture-${String(index).padStart(2, "0")}`
  );

  for (const gameId of gameIds.slice(0, CONTENT_BUNDLE_CACHE_MAX_ENTRIES)) {
    await service.getBundle(gameId);
  }
  await service.getBundle(gameIds[0]!); // Refresh the oldest entry before pressure.
  await service.getBundle(gameIds.at(-1)!);

  await service.getBundle(gameIds[0]!);
  await service.getBundle(gameIds[1]!);

  assert.equal(repository.readCount(gameIds[0]!), 1, "the refreshed entry must remain cached");
  assert.equal(repository.readCount(gameIds[1]!), 2, "the actual least-recently-used entry must reload");
});

test("the published source cannot alias an explicit source named default", async () => {
  const template = JSON.parse(await readFile(
    new URL("../../../games/simple-choice/game.manifest.json", import.meta.url),
    "utf8"
  )) as Record<string, unknown>;
  const published = new CountingManifestRepository(template, "published");
  const preview = new CountingManifestRepository(template, "preview");
  const service = new ContentService(published, () => preview);

  const publishedBundle = await service.getBundle("source-isolation");
  service.registerLocalContentRoot("default", "preview-root");
  const previewBundle = await service.getBundle("source-isolation", "default");

  assert.equal(publishedBundle.manifest.meta.description, "published");
  assert.equal(previewBundle.manifest.meta.description, "preview");
  assert.equal(published.readCount("source-isolation"), 1);
  assert.equal(preview.readCount("source-isolation"), 1);
});

test("an in-flight load cannot repopulate a replaced content source cache", async () => {
  const template = JSON.parse(await readFile(
    new URL("../../../games/simple-choice/game.manifest.json", import.meta.url),
    "utf8"
  )) as Record<string, unknown>;
  let markEntered!: () => void;
  let releaseOld!: () => void;
  const entered = new Promise<void>((resolve) => { markEntered = resolve; });
  const oldGate = new Promise<void>((resolve) => { releaseOld = resolve; });
  const oldRepository = new CountingManifestRepository(template, "old", async () => {
    markEntered();
    await oldGate;
  });
  const newRepository = new CountingManifestRepository(template, "new");
  const repositories = new Map([
    ["old-root", oldRepository],
    ["new-root", newRepository]
  ]);
  const service = new ContentService(
    new CountingManifestRepository(template, "published"),
    (contentRoot) => repositories.get(contentRoot)!
  );

  service.registerLocalContentRoot("preview", "old-root");
  const oldLoad = service.getBundle("source-race", "preview");
  await entered;
  service.registerLocalContentRoot("preview", "new-root");
  releaseOld();
  assert.equal((await oldLoad).manifest.meta.description, "new");

  const fresh = await service.getBundle("source-race", "preview");
  assert.equal(fresh.manifest.meta.description, "new");
  assert.equal(newRepository.readCount("source-race"), 1);
});

class CountingManifestRepository implements IGameRepository {
  private readonly reads = new Map<string, number>();
  private readonly template: Record<string, unknown>;
  private readonly label: string;
  private readonly beforeRead?: () => Promise<void>;

  constructor(
    template: Record<string, unknown>,
    label = "fixture",
    beforeRead?: () => Promise<void>
  ) {
    this.template = template;
    this.label = label;
    this.beforeRead = beforeRead;
  }

  readCount(gameId: string): number {
    return this.reads.get(gameId) ?? 0;
  }

  async listGameIds(): Promise<readonly string[]> {
    return [];
  }

  async getManifestRaw(gameId: string): Promise<string> {
    this.reads.set(gameId, this.readCount(gameId) + 1);
    await this.beforeRead?.();
    const manifest = structuredClone(this.template) as unknown as GameManifest;
    manifest.meta.id = gameId;
    manifest.meta.name = gameId;
    manifest.meta.description = this.label;
    // The cache test is independent of generated game artifact freshness. Pin
    // its cloned fixture to the current executor registry, then republish the
    // compiler-owned identities that include the module lock.
    manifest.mechanics.moduleLock = recommendedModuleLock(Object.keys(manifest.mechanics.moduleLock));
    republishFixtureHashes(manifest);
    return JSON.stringify(manifest);
  }

  async getUiManifestRaw(): Promise<string | undefined> { return undefined; }
  async getMockupFiles(): Promise<Array<{ filename: string; raw: string }>> { return []; }
  async getPublishedPlayerWebPluginBundlesRaw(): Promise<string | undefined> { return undefined; }
  async getPublishedPlayerWebPluginBundleRaw(): Promise<string> { throw new Error("not used"); }
  async getPublishedGameStylesheetsRaw(): Promise<string | undefined> { return undefined; }
  async getPublishedGameStylesheetRaw(): Promise<string> { throw new Error("not used"); }
  async getGameAssetsRegistryRaw(): Promise<string | undefined> { return undefined; }
  async getGameAssetFileMetadata(): Promise<GameAssetFileMetadata> { throw new Error("not used"); }
  async getGameAssetFileBytes(): Promise<Buffer> { throw new Error("not used"); }
}

function republishFixtureHashes(manifest: GameManifest): void {
  const networkModelsHash = mechanicsSha256(manifest.networkModels ?? {});
  for (const [planId, plan] of Object.entries(manifest.mechanics.plans)) {
    plan.planHash = mechanicsSha256({
      apiVersion: manifest.mechanics.apiVersion,
      budgetProfile: manifest.mechanics.budgetProfile,
      moduleLock: manifest.mechanics.moduleLock,
      stateModel: manifest.mechanics.stateModel,
      objectModels: manifest.objectModels ?? {},
      networkModelsHash,
      planId,
      transaction: plan.transaction
    });
  }
  for (const [actionId, action] of Object.entries(manifest.actions)) {
    const { definitionHash: _oldHash, ...definition } = action;
    action.definitionHash = mechanicsSha256({
      apiVersion: manifest.mechanics.apiVersion,
      actionId,
      definition,
      planHash: manifest.mechanics.plans[action.binding.planRef]!.planHash
    });
  }
}
