/**
 * Browser proof for the first Cards Money Trains operating turn on real data.
 *
 * The author has confirmed the normal team setup, placement procedure, initial
 * road states, network geometry and deck lifecycle. During final acceptance
 * the source may still carry the explicit browser gate or may already be
 * promoted. These tests materialize an isolated preview copy under
 * `.tmp/editor-worktrees`, which is the existing trusted editor-preview
 * boundary. The browser still uses the ordinary Player Web BFF, HttpOnly
 * session credential, immutable runtime bundle, map-first UI and production
 * Mechanics dispatcher.
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
    readonly lastEventSequence: number;
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
        readonly status?: string;
        readonly turnNumber?: number;
        readonly fixtureId?: string;
        readonly finishConfirmationPending?: boolean;
        readonly canRequestFinish?: boolean;
      };
      readonly setup?: {
        readonly currentTeamId: string;
      };
      readonly cards?: {
        readonly initialized: boolean;
        readonly cargo: {
          readonly selectionOrder: readonly string[];
          readonly currentWagonId: string | null;
        };
      };
      readonly movement?: {
        readonly locomotiveOrder: readonly string[];
        readonly currentLocomotiveId: string | null;
      };
      readonly finalResults?: {
        readonly status: string;
        readonly rankings: Readonly<Record<string, unknown>> | null;
      } | null;
      readonly teams: Record<string, {
        readonly coins: number;
      }>;
      readonly objects: {
        readonly teams: Record<string, {
          readonly facets: {
            readonly placementStatus: string;
          };
          readonly attributes: {
            readonly type: string;
            readonly coins: number;
          };
        }>;
        readonly networkNodes: Record<string, {
          readonly objectType: string;
          readonly facets: {
            readonly availability: string;
          };
        }>;
        readonly networkEdges: Record<string, {
          readonly facets: {
            readonly state: string;
          };
        }>;
        readonly locomotives: Record<string, {
          readonly facets: {
            readonly availability: string;
          };
          readonly attributes: {
            readonly nodeId: string;
            readonly actionPoints: number;
            readonly ownerTeamId: string;
            readonly maintenancePaidTurn: number;
          };
        }>;
        readonly wagons: Record<string, {
          readonly facets: {
            readonly availability: string;
          };
          readonly attributes: {
            readonly nodeId: string;
            readonly cargoId: string | null;
            readonly attachedVehicleId: string | null;
            readonly ownerTeamId: string;
            readonly maintenancePaidTurn: number;
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
  readonly branch?: BranchName;
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

interface BrowserActionField {
  readonly parameter: string;
  readonly label: string;
  readonly value: string;
  readonly kind: "select" | "text";
}

const temporaryRoots = new Set<string>();

test.afterAll(() => {
  for (const root of temporaryRoots) {
    rmSync(root, { recursive: true, force: true });
  }
});

test.describe("Cards Money Trains real operating-turn preview", { tag: "@player" }, () => {
  test("completes a normal first turn and finishes through facilitator controls", async ({ page }) => {
    // This path intentionally drives every setup asset and ordinary phase over
    // the production HTTP boundary. On the shared low-memory host the full
    // 50-action journey is substantially longer than the focused replay tests.
    test.setTimeout(900_000);
    let generatedRequestBody: JsonRecord | null = null;
    let readyDebrief: JsonRecord | null = null;
    await page.route("**/api/runtime/sessions/*/facilitator-debrief", async (route) => {
      const request = route.request();
      const encodedSessionId = new URL(request.url()).pathname.split("/").at(-2) ?? "";
      const sessionId = decodeURIComponent(encodedSessionId);
      if (request.method() === "POST") {
        generatedRequestBody = request.postDataJSON() as JsonRecord;
        readyDebrief = {
          format: "cubica.facilitator-debrief",
          schemaVersion: "1.0.0",
          sessionId,
          gameId: GAME_ID,
          status: "ready",
          canGenerate: false,
          runId: "debrief_browserproof1",
          requestedAt: "2026-08-27T10:00:00.000Z",
          completedAt: "2026-08-27T10:00:20.000Z",
          journalSha256: `sha256:${"a".repeat(64)}`,
          throughEventSequence: 1,
          provider: "z.ai",
          model: "glm-4.7",
          promptVersion: "facilitator-debrief-ru-v1",
          draft: {
            title: "Проверяемый итог партии",
            summary: "Черновик связан с завершённой игровой сессией.",
            facts: [{ statement: "Партия завершена.", eventSequences: [1] }],
            interpretations: [],
            reflectionQuestions: [{ question: "Что определило итог?", eventSequences: [1] }]
          }
        };
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(readyDebrief ?? {
          format: "cubica.facilitator-debrief",
          schemaVersion: "1.0.0",
          sessionId,
          gameId: GAME_ID,
          status: "absent",
          canGenerate: true
        })
      });
    });
    const source = materializeNormativePreviewSource();
    let snapshot = await openPreviewSession(page, source);
    const board = page.getByRole("region", { name: BOARD_LABEL });

    await expectMapFirstSurface(board);
    expect(snapshot.state.public.session.fixtureId).toBe("normal-start-policy");
    expect(snapshot.state.public.session.phase).toBe("setup");
    expectNoSecretDecks(snapshot);

    snapshot = await runBoardAction(page, board, {
      actionId: "cards.lifecycle.initialize",
      label: "Подготовить колоды грузов и новостей"
    });
    expect(snapshot.state.public.cards?.initialized).toBe(true);

    const teamInputs = [
      ["session.setup.team.add.logistics-company", "Добавить компанию-перевозчика", "Перевозчик Север", "cobalt"],
      ["session.setup.team.add.logistics-company", "Добавить компанию-перевозчика", "Перевозчик Центр", "orange"],
      ["session.setup.team.add.logistics-company", "Добавить компанию-перевозчика", "Перевозчик Юг", "emerald"],
      ["session.setup.team.add.locomotive-guild", "Добавить паровозную гильдию", "Гильдия Восток", "magenta"],
      ["session.setup.team.add.locomotive-guild", "Добавить паровозную гильдию", "Гильдия Запад", "cyan"]
    ] as const;
    for (const [actionId, label, name, colorId] of teamInputs) {
      snapshot = await runBoardAction(page, board, {
        actionId,
        label,
        fields: [
          { parameter: "name", label: "Название команды", value: name, kind: "text" },
          { parameter: "colorId", label: "Цвет команды", value: colorId, kind: "select" }
        ]
      });
    }

    snapshot = await runBoardAction(page, board, {
      actionId: "session.setup.finalize",
      label: "Зафиксировать команды и очередь расстановки"
    });
    expect(snapshot.state.public.session.phase).toBe("setup-placement");

    let placementActions = 0;
    while (snapshot.state.public.session.phase !== "setup-complete") {
      if (placementActions >= 20) {
        throw new Error("Normal setup did not complete within the bounded asset count.");
      }
      const currentTeamId = snapshot.state.public.setup?.currentTeamId;
      if (!currentTeamId) throw new Error("Setup placement has no current public team.");
      const stationId = findOpenTerminalId(snapshot);
      const wagonId = findReserveVehicleId(snapshot, "wagons", currentTeamId);
      const locomotiveId = findReserveVehicleId(snapshot, "locomotives", currentTeamId);

      if (wagonId) {
        snapshot = await runBoardAction(page, board, {
          actionId: "session.setup.place.wagon",
          label: "Разместить вагон",
          fields: [
            { parameter: "wagonId", label: "Вагон", value: wagonId, kind: "select" },
            {
              parameter: "stationId",
              label: "Станция или полустанок",
              value: stationId,
              kind: "select"
            }
          ]
        });
      } else if (locomotiveId) {
        snapshot = await runBoardAction(page, board, {
          actionId: "session.setup.place.locomotive",
          label: "Разместить локомотив",
          fields: [
            {
              parameter: "locomotiveId",
              label: "Локомотив",
              value: locomotiveId,
              kind: "select"
            },
            {
              parameter: "stationId",
              label: "Станция или полустанок",
              value: stationId,
              kind: "select"
            }
          ]
        });
      } else {
        throw new Error(`Current setup team "${currentTeamId}" has no reserve vehicle.`);
      }
      placementActions += 1;
    }
    expect(placementActions).toBe(8);

    snapshot = await runBoardAction(page, board, {
      actionId: "session.play.start",
      label: "Начать первый ход"
    });
    snapshot = await runBoardAction(page, board, {
      actionId: "news.lifecycle.first-turn.skip",
      label: "Пропустить новость первого хода"
    });
    expect(snapshot.state.public.session.phase).toBe("maintenance");

    let maintenanceActions = 0;
    while (true) {
      if (maintenanceActions >= 20) {
        throw new Error("First-turn maintenance exceeded the bounded active vehicle count.");
      }
      const turnNumber = snapshot.state.public.session.turnNumber;
      const locomotiveId = findUnpaidActiveVehicleId(snapshot, "locomotives", turnNumber);
      const wagonId = findUnpaidActiveVehicleId(snapshot, "wagons", turnNumber);
      if (!locomotiveId && !wagonId) break;

      snapshot = locomotiveId
        ? await runBoardAction(page, board, {
            actionId: "maintenance.pay.locomotive",
            label: "Оплатить обслуживание локомотива",
            fields: [{
              parameter: "locomotiveId",
              label: "Локомотив",
              value: locomotiveId,
              kind: "select"
            }]
          })
        : await runBoardAction(page, board, {
            actionId: "maintenance.pay.wagon",
            label: "Оплатить обслуживание вагона",
            fields: [{
              parameter: "wagonId",
              label: "Вагон",
              value: wagonId!,
              kind: "select"
            }]
          });
      maintenanceActions += 1;
    }
    expect(maintenanceActions).toBe(8);
    snapshot = await runBoardAction(page, board, {
      actionId: "maintenance.phase.finish",
      label: "Завершить обслуживание"
    });
    expect(snapshot.state.public.session.phase).toBe("market");

    const logisticsTeamId = findPlacedTeamId(snapshot, "logistics_company");
    const purchaseTerminalId = findOpenTerminalId(snapshot);
    const wagonIdsBeforePurchase = new Set(Object.keys(snapshot.state.public.objects.wagons));
    snapshot = await runBoardAction(page, board, {
      actionId: "market.purchase.wagon",
      label: "Купить вагон",
      fields: [
        { parameter: "teamId", label: "Команда", value: logisticsTeamId, kind: "select" },
        {
          parameter: "stationId",
          label: "Терминал покупки",
          value: purchaseTerminalId,
          kind: "select"
        }
      ]
    });
    const purchasedWagonId = Object.keys(snapshot.state.public.objects.wagons)
      .find((wagonId) => !wagonIdsBeforePurchase.has(wagonId));
    if (!purchasedWagonId) throw new Error("Market purchase did not publish its new wagon.");
    snapshot = await runBoardAction(page, board, {
      actionId: "market.sell.wagon",
      label: "Продать вагон",
      fields: [{ parameter: "wagonId", label: "Вагон", value: purchasedWagonId, kind: "select" }]
    });
    snapshot = await runBoardAction(page, board, {
      actionId: "market.phase.finish",
      label: "Завершить рынок"
    });
    expect(snapshot.state.public.session.phase).toBe("cargo");

    snapshot = await runBoardAction(page, board, {
      actionId: "cargo.queue.prepare",
      label: "Подготовить очередь выбора грузов"
    });
    let cargoOffers = 0;
    while (snapshot.state.public.cards?.cargo.currentWagonId) {
      if (cargoOffers >= 20) {
        throw new Error("Cargo selection exceeded the bounded active wagon count.");
      }
      const wagonId = snapshot.state.public.cards.cargo.currentWagonId;
      const terminalId = snapshot.state.public.objects.wagons[wagonId]?.attributes.nodeId;
      if (!terminalId || !isOpenTerminal(snapshot, terminalId)) {
        throw new Error(`Current cargo wagon "${wagonId}" has no open public terminal.`);
      }
      snapshot = await runBoardAction(page, board, {
        actionId: "cargo.offer.draw",
        label: "Предложить грузы выбранного терминала",
        fields: [{ parameter: "terminalId", label: "Терминал", value: terminalId, kind: "select" }]
      });
      snapshot = await runBoardAction(page, board, {
        actionId: "cargo.offer.skip",
        label: "Вернуть предложенные грузы",
        fields: [{ parameter: "terminalId", label: "Терминал", value: terminalId, kind: "select" }]
      });
      cargoOffers += 1;
    }
    expect(cargoOffers).toBe(6);
    expect(snapshot.state.public.cards?.cargo.selectionOrder).toEqual([]);
    snapshot = await runBoardAction(page, board, {
      actionId: "cargo.phase.finish",
      label: "Завершить выбор и погрузку"
    });
    expect(snapshot.state.public.session.phase).toBe("movement-order");

    snapshot = await runBoardAction(page, board, {
      actionId: "movement.order.prepare",
      label: "Подготовить порядок движения"
    });
    let movementActions = 0;
    while (snapshot.state.public.session.phase === "operations") {
      if (movementActions >= 20) {
        throw new Error("Movement exceeded the bounded active locomotive count.");
      }
      const locomotiveId = snapshot.state.public.movement?.currentLocomotiveId;
      if (!locomotiveId) throw new Error("Movement has no current public locomotive.");
      expect(snapshot.state.public.objects.locomotives[locomotiveId]?.facets.availability)
        .toBe("active");
      snapshot = await runBoardAction(page, board, {
        actionId: "movement.locomotive.skip",
        label: "Пропустить движение текущего локомотива"
      });
      movementActions += 1;
    }
    expect(movementActions).toBe(2);
    expect(snapshot.state.public.session.phase).toBe("settlement");

    snapshot = await runBoardAction(page, board, {
      actionId: "settlement.phase.finish",
      label: "Завершить расчёты"
    });
    snapshot = await runBoardAction(page, board, {
      actionId: "construction.phase.finish",
      label: "Завершить строительство"
    });
    expect(snapshot.state.public.session.phase).toBe("reporting");
    expect(snapshot.state.public.session.canRequestFinish).toBe(true);

    snapshot = await clickManifestAction(
      page,
      page.locator('[id="facilitator.finish-request"]'),
      "session.finish.request"
    );
    expect(snapshot.state.public.session.finishConfirmationPending).toBe(true);
    snapshot = await clickManifestAction(
      page,
      page.locator('[id="facilitator.finish-confirm"]'),
      "session.finish.confirm"
    );

    expect(snapshot.state.public.session.phase).toBe("finished");
    expect(snapshot.state.public.session.status).toBe("finished");
    expect(snapshot.state.public.finalResults?.status).toBe("calculated");
    expect(snapshot.state.public.finalResults?.rankings).toBeDefined();
    expect(snapshot.state.public.finalResults?.rankings).not.toBeNull();
    expect(Object.keys(snapshot.state.public.finalResults?.rankings ?? {})).toHaveLength(2);
    expect(snapshot.state.public.session.fixtureId).toBe("normal-start-policy");
    expectNoSecretDecks(snapshot);
    await expect(page.getByText(/Этап:\s*finished/iu)).toBeVisible();

    const debriefToggle = page.getByText("Открыть разбор ведущего", { exact: true });
    await expect(debriefToggle).toBeVisible();
    await debriefToggle.click();
    await page.getByRole("button", { name: "Сформировать разбор" }).click();
    await expect(page.getByText("Проверяемый итог партии", { exact: true })).toBeVisible();
    expect(generatedRequestBody).toEqual({ expectedStateVersion: snapshot.version.stateVersion });
    await expect(page.getByText("debrief_browserproof1", { exact: true })).toBeVisible();
    await expect(page.getByText(`sha256:${"a".repeat(64)}`, { exact: true })).toBeVisible();

    await page.reload();
    await expect(page.getByText("Открыть разбор ведущего", { exact: true })).toBeVisible();
    await page.getByText("Открыть разбор ведущего", { exact: true }).click();
    await expect(page.getByText("debrief_browserproof1", { exact: true })).toBeVisible();
    await expect(page.getByText(`sha256:${"a".repeat(64)}`, { exact: true })).toBeVisible();
  });

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

    // The news transition itself is a state-only technical proof and emits no
    // public event. The first manifest-declared public event in this branch is
    // cargo.loaded, so download after that confirmed action while retaining
    // the news action as the scenario's causal prerequisite.
    snapshot = await clickBoardAction(page, board, "Технический replay: загрузить груз");
    expect(snapshot.receipt?.status).toBe("applied");

    const journalLink = page.getByRole("link", { name: "Скачать журнал" });
    await expect(journalLink).toBeVisible();
    await expect(journalLink).toHaveAttribute(
      "href",
      `/api/runtime/sessions/${encodeURIComponent(snapshot.sessionId)}/public-journal`
    );
    const [journalDownload] = await Promise.all([
      page.waitForEvent("download"),
      journalLink.click()
    ]);
    const journalPath = await journalDownload.path();
    if (!journalPath) throw new Error("Public journal download did not produce a file.");
    const journal = JSON.parse(readFileSync(journalPath, "utf8")) as JsonRecord;
    expect(journal.format).toBe("cubica.public-gameplay-journal");
    expect(journal.schemaVersion).toBe("1.0.0");
    expect(journal.sessionId).toBe(snapshot.sessionId);
    expect(journal.throughEventSequence).toBe(snapshot.version.lastEventSequence);
    expect(Array.isArray(journal.entries)).toBe(true);
    expect((journal.entries as unknown[]).length).toBeGreaterThan(0);
    const journalEntries = journal.entries as Array<JsonRecord>;
    const terminalEntry = journalEntries.find(
      (entry) => entry.sequence === snapshot.version.lastEventSequence
    );
    expect(terminalEntry).toBeDefined();
    expect(terminalEntry?.eventType).toBe("cargo.loaded");
    expect(terminalEntry?.data).toMatchObject({
      kind: "cargo-load",
      cargoId: "cargo-source-row-005",
      wagonId: "technical-wagon-white-1"
    });
    const journalText = JSON.stringify(journal);
    for (const protectedField of ["principalId", "commandId", "receiptId", "mechanicsAudit"]) {
      expect(journalText).not.toContain(protectedField);
    }

    expect(snapshot.state.public.session.phase).toBe("operations");

    snapshot = await clickBoardAction(page, board, "Технический replay: прицепить вагон");
    expect(snapshot.receipt?.status).toBe("applied");
    snapshot = await clickBoardAction(page, board, "Технический replay: перейти по дороге");
    expect(snapshot.receipt?.status).toBe("applied");
    snapshot = await clickBoardAction(page, board, "Технический replay: доставить груз");
    expect(snapshot.receipt?.status).toBe("applied");
    expectNoSecretDecks(snapshot);

    expect(
      snapshot.state.public.objects.teams["white-logistics"]?.attributes.coins
    ).toBe(24);
    expect(
      snapshot.state.public.objects.teams["purple-guild"]?.attributes.coins
    ).toBe(12);
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
 * The technical clone is launchable whether the normative package is still at
 * its release gate or is already published. Its actions still require the
 * fixture id, so they cannot execute against an ordinary initial state.
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
  if (typeof config.runtimeReady !== "boolean") {
    throw new Error("Normative Cards Money Trains has no runtime-ready verdict.");
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

  return materializePreviewFiles(
    previewManifest,
    `cmt-real-${branchName}`,
    pluginMetadata,
    branchName
  );
}

/** Enable only the trusted editor preview boundary around the normal package. */
function materializeNormativePreviewSource(): PreviewSource {
  const sourceManifest = readJson<JsonRecord>(
    path.join(SOURCE_GAME_ROOT, "game.manifest.json")
  );
  const pluginMetadata = readJson<{ readonly bundles: readonly PublishedPluginBundle[] }>(
    path.join(SOURCE_GAME_ROOT, "published", "player-web-plugin-bundles.json")
  );
  const config = requireRecord(sourceManifest.config, "manifest.config");
  const state = requireRecord(sourceManifest.state, "manifest.state");
  const publicState = requireRecord(state.public, "manifest.state.public");
  const session = requireRecord(publicState.session, "manifest.state.public.session");
  if (config.runtimeReady !== true) {
    throw new Error("Normative Cards Money Trains must be runtime-ready before its release E2E.");
  }
  if ("runtimeBlockers" in config) {
    throw new Error("Runtime-ready Cards Money Trains must not retain release blockers.");
  }
  if (session.fixtureId !== "normal-start-policy" || session.phase !== "setup") {
    throw new Error("Normative preview must start from the normal setup policy.");
  }

  return materializePreviewFiles(sourceManifest, "cmt-normative", pluginMetadata);
}

/** Write one immutable preview clone and its byte-verified player plugin. */
function materializePreviewFiles(
  previewManifest: JsonRecord,
  sourcePrefix: string,
  pluginMetadata: { readonly bundles: readonly PublishedPluginBundle[] },
  branch?: BranchName
): PreviewSource {
  const contentSourceId =
    `${sourcePrefix}-${randomUUID().replaceAll("-", "").slice(0, 12)}`;
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
    ...(branch === undefined ? {} : { branch }),
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
  await ensureBoardActionsVisible(board);
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

/** Submit one normal keyboard form/button and read its matching BFF response. */
async function runBoardAction(
  page: Page,
  board: ReturnType<Page["locator"]>,
  action: {
    readonly actionId: string;
    readonly label: string;
    readonly fields?: readonly BrowserActionField[];
  }
): Promise<RuntimeSnapshot> {
  expect(action.actionId).not.toMatch(/^technical\./u);
  await ensureBoardActionsVisible(board);
  const expectedParams = Object.fromEntries(
    (action.fields ?? []).map((field) => [field.parameter, field.value])
  );
  const responsePromise = page.waitForResponse((candidate) =>
    candidate.url().endsWith("/api/runtime/actions") &&
    candidate.request().method() === "POST" &&
    candidate.request().postDataJSON()?.actionId === action.actionId
  );

  if (action.fields && action.fields.length > 0) {
    const form = board.getByRole("form", { name: action.label, exact: true });
    await expect(form).toBeVisible();
    for (const field of action.fields) {
      // Keep the action form discoverable by its accessible name, then address
      // its controlled fields by the stable authored parameter. The CMT scene
      // mirrors every draft edit back into React, so the parameter keeps this
      // locator stable across those controlled rerenders.
      const control = form.locator(`[name="${field.parameter}"]`);
      await expect(control).toHaveAccessibleName(field.label);
      if (field.kind === "select") {
        await expect(control.locator(`option[value="${field.value}"]`)).toHaveCount(1);
        await control.selectOption(field.value);
      } else {
        await control.fill(field.value);
      }
      await expect(control).toHaveValue(field.value);
    }
    const submit = form.getByRole("button", { name: action.label, exact: true });
    await expect(submit).toBeEnabled();
    await submit.click();
  } else {
    const button = board.getByRole("button", { name: action.label, exact: true });
    await expect(button).toBeVisible();
    await expect(button).toBeEnabled();
    await button.click();
  }

  const response = await responsePromise;
  const requestBody = response.request().postDataJSON() as JsonRecord;
  expect(requestBody.actionId).toBe(action.actionId);
  expect(requestBody.params).toEqual(expectedParams);
  const snapshot = await responseJson<RuntimeSnapshot>(response);
  expect(
    snapshot.receipt?.status,
    `${action.actionId} was rejected: ${snapshot.receipt?.rejectionCode ?? "unknown reason"}`
  ).toBe("applied");
  expectNoSecretDecks(snapshot);
  await expect(
    board.getByRole("button", { name: "Выполняется…", exact: true })
  ).toHaveCount(0);
  return snapshot;
}

/** Open the map-first action drawer exactly when the current render closed it. */
async function ensureBoardActionsVisible(
  board: ReturnType<Page["locator"]>
): Promise<void> {
  const toggle = board.getByRole("button", {
    name: /^(?:Действия|Закрыть действия)$/u
  });
  await expect(toggle).toBeVisible();
  if (await toggle.getAttribute("aria-expanded") !== "true") {
    await toggle.click();
  }
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
}

/** Click one manifest-authored action outside the board and match its response. */
async function clickManifestAction(
  page: Page,
  control: ReturnType<Page["locator"]>,
  actionId: string
): Promise<RuntimeSnapshot> {
  const responsePromise = page.waitForResponse((candidate) =>
    candidate.url().endsWith("/api/runtime/actions") &&
    candidate.request().method() === "POST" &&
    candidate.request().postDataJSON()?.actionId === actionId
  );
  await expect(control).toBeVisible();
  await expect(control).toBeEnabled();
  await control.click();
  const response = await responsePromise;
  const requestBody = response.request().postDataJSON() as JsonRecord;
  expect(requestBody.actionId).toBe(actionId);
  expect(requestBody.params).toEqual({});
  const snapshot = await responseJson<RuntimeSnapshot>(response);
  expect(
    snapshot.receipt?.status,
    `${actionId} was rejected: ${snapshot.receipt?.rejectionCode ?? "unknown reason"}`
  ).toBe("applied");
  expectNoSecretDecks(snapshot);
  return snapshot;
}

function findOpenTerminalId(snapshot: RuntimeSnapshot): string {
  const terminalId = Object.entries(snapshot.state.public.objects.networkNodes)
    .sort(([left], [right]) => left.localeCompare(right))
    .find(([, node]) =>
      node.objectType === "transport.terminal" && node.facets.availability === "open"
    )?.[0];
  if (!terminalId) throw new Error("The public snapshot has no open terminal.");
  return terminalId;
}

function isOpenTerminal(snapshot: RuntimeSnapshot, nodeId: string): boolean {
  const node = snapshot.state.public.objects.networkNodes[nodeId];
  return node?.objectType === "transport.terminal" && node.facets.availability === "open";
}

function findReserveVehicleId(
  snapshot: RuntimeSnapshot,
  collection: "locomotives" | "wagons",
  teamId: string
): string | null {
  return Object.entries(snapshot.state.public.objects[collection])
    .sort(([left], [right]) => left.localeCompare(right))
    .find(([, vehicle]) =>
      vehicle.attributes.ownerTeamId === teamId && vehicle.facets.availability === "reserve"
    )?.[0] ?? null;
}

function findUnpaidActiveVehicleId(
  snapshot: RuntimeSnapshot,
  collection: "locomotives" | "wagons",
  turnNumber: number | undefined
): string | null {
  if (turnNumber === undefined) throw new Error("The public snapshot has no turn number.");
  return Object.entries(snapshot.state.public.objects[collection])
    .sort(([left], [right]) => left.localeCompare(right))
    .find(([, vehicle]) =>
      vehicle.facets.availability === "active" &&
      vehicle.attributes.maintenancePaidTurn !== turnNumber
    )?.[0] ?? null;
}

function findPlacedTeamId(snapshot: RuntimeSnapshot, type: string): string {
  const teamId = Object.entries(snapshot.state.public.objects.teams)
    .sort(([left], [right]) => left.localeCompare(right))
    .find(([, team]) =>
      team.attributes.type === type && team.facets.placementStatus === "placed"
    )?.[0];
  if (!teamId) throw new Error(`The public snapshot has no placed ${type} team.`);
  return teamId;
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
