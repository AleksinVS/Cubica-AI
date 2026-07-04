import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { ManifestValidationError } from "../src/modules/errors.ts";
import { validateGameManifest } from "../src/modules/content/manifestValidation.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const validManifest = {
  meta: {
    id: "data",
    version: "1.0.0",
    name: "Antarctica",
    description: "Demo game",
    author: "Cubica",
    schemaVersion: "1.1"
  },
  config: {
    players: { min: 1, max: 1 },
    settings: { mode: "singleplayer", locale: "ru-RU" }
  },
  state: {
    public: {
      timeline: { line: "main", stepIndex: 0, stageId: "stage_intro", screenId: "S1" },
      log: [],
      flags: { team: {} },
      objects: { cards: {} }
    }
  },
  actions: {
    openSharedGuidePanel: {
      handlerType: "script",
      capabilityFamily: "ui.panel",
      capability: "ui.panel.hint",
      function: "openSharedGuidePanel"
    }
  }
};

// Antarctica player-facing content entries for boards 55-60, 61-66, 67-70 and infos i17-i21
const openingTailDataContent = {
  infos: [
    {
      id: "i17",
      stepIndex: 31,
      screenId: "S1",
      title: "Ускорение процесса",
      body: "Настало время ускорить процесс переезда.",
      advanceActionId: "opening.info.i17.advance",
      advanceLabel: "Продолжить"
    },
    {
      id: "i18",
      stepIndex: 33,
      screenId: "S1",
      title: "Отправка разведчиков",
      body: "Разведчики готовы к отправке.",
      advanceActionId: "opening.info.i18.advance",
      advanceLabel: "Продолжить"
    },
    {
      id: "i19",
      stepIndex: 35,
      screenId: "S1",
      title: "Последствия переезда",
      body: "После переезда началась работа над укреплением позиций.",
      advanceActionId: "opening.info.i19.advance",
      advanceLabel: "Продолжить"
    },
    {
      id: "i19_1",
      stepIndex: 35,
      screenId: "S1",
      title: "Быстрый переезд",
      body: "Переезд был осуществлен быстро.",
      advanceActionId: "opening.info.i19.advance",
      advanceLabel: "Продолжить"
    },
    {
      id: "i20",
      stepIndex: 37,
      screenId: "S1",
      title: "Второй переезд",
      body: "Готовим второй переезд.",
      advanceActionId: "opening.info.i20.advance",
      advanceLabel: "Продолжить"
    },
    {
      id: "i21",
      stepIndex: 38,
      screenId: "S1",
      title: "Финальный экран",
      body: "История завершена.",
      advanceActionId: "opening.info.i21.advance",
      advanceLabel: "Завершить"
    }
  ],
  boards: [
    {
      id: "opening.board.55_60",
      title: "Выберите десятый шаг",
      body: "Теперь у вас есть еще несколько способов продолжить работу штаба.",
      stepIndex: 30,
      screenId: "S2",
      cardIds: ["55", "56", "57", "58", "59", "60"]
    },
    {
      id: "opening.board.61_66",
      title: "Выберите одинадцатый шаг",
      body: "Отправка разведчиков требует особого подхода.",
      stepIndex: 32,
      screenId: "S2",
      cardIds: ["61", "62", "63", "64", "65", "66"]
    },
    {
      id: "opening.board.67_68",
      title: "Выберите двенадцатый шаг",
      body: "Последняя проверка перед переездом.",
      stepIndex: 34,
      screenId: "S2",
      cardIds: ["67", "68"]
    },
    {
      id: "opening.board.69_70",
      title: "Выберите тринадцатый шаг",
      body: "После переезда нужно укрепить позиции.",
      stepIndex: 36,
      screenId: "S2",
      cardIds: ["69", "70"]
    }
  ],
  cards: [
    { cardId: "55", title: "Привлечь скептиков", summary: "Детали переезда убедят скептиков.", selectActionId: "opening.card.55", selectLabel: "Выбрать", advanceActionId: "opening.card.55.advance", advanceLabel: "Продолжить" },
    { cardId: "56", title: "Нейтрализовать Григория", summary: "Помощник Григория поможет.", selectActionId: "opening.card.56", selectLabel: "Выбрать" },
    { cardId: "57", title: "Поговорить с детьми", summary: "Дети - наша надежда.", selectActionId: "opening.card.57", selectLabel: "Выбрать", advanceActionId: "opening.card.57.advance", advanceLabel: "Продолжить" },
    { cardId: "58", title: "Семейные ужины", summary: "Ужины укрепляют семью.", selectActionId: "opening.card.58", selectLabel: "Выбрать", advanceActionId: "opening.card.58.advance", advanceLabel: "Продолжить" },
    { cardId: "59", title: "Усилить участие", summary: "Команда изменений усиливает позиции.", selectActionId: "opening.card.59", selectLabel: "Выбрать" },
    { cardId: "60", title: "Школа разведчика", summary: "Обучение разведчиков.", selectActionId: "opening.card.60", selectLabel: "Выбрать", advanceActionId: "opening.card.60.advance", advanceLabel: "Продолжить" },
    { cardId: "61", title: "Отправить элитную группу", summary: "Элитная группа отправляется.", selectActionId: "opening.card.61", selectLabel: "Выбрать", advanceActionId: "opening.card.61.advance", advanceLabel: "Продолжить" },
    { cardId: "62", title: "Добрать желающих", summary: "Добор добровольцев.", selectActionId: "opening.card.62", selectLabel: "Выбрать" },
    { cardId: "63", title: "Доукомплектовать лучшими", summary: "Лучшие идут в группу.", selectActionId: "opening.card.63", selectLabel: "Выбрать" },
    { cardId: "64", title: "Пресечь борьбу", summary: "Борьба за влияние пресечена.", selectActionId: "opening.card.64", selectLabel: "Выбрать" },
    { cardId: "65", title: "Развести конфликт", summary: "Конфликт разведен.", selectActionId: "opening.card.65", selectLabel: "Выбрать" },
    { cardId: "66", title: "Отправить готовую группу", summary: "Группа полностью готова.", selectActionId: "opening.card.66", selectLabel: "Выбрать", advanceActionId: "opening.card.66.advance", advanceLabel: "Продолжить" },
    { cardId: "67", title: "Кабинетный анализ", summary: "Профессор проводит анализ.", selectActionId: "opening.card.67", selectLabel: "Выбрать" },
    { cardId: "68", title: "Отправить экспертную группу", summary: "Эксперты отправлены.", selectActionId: "opening.card.68", selectLabel: "Выбрать", advanceActionId: "opening.card.68.advance", advanceLabel: "Продолжить" },
    { cardId: "69", title: "Готовить второй переезд", summary: "Второй переезд начинается.", selectActionId: "opening.card.69", selectLabel: "Выбрать", advanceActionId: "opening.card.69.advance", advanceLabel: "Продолжить" },
    { cardId: "70", title: "Взять паузу", summary: "Пауза перед изменениями.", selectActionId: "opening.card.70", selectLabel: "Выбрать" }
  ]
};

test("validateGameManifest accepts a well-formed manifest", () => {
  const manifest = validateGameManifest(validManifest) as typeof validManifest;

  assert.equal(manifest.meta.id, "data");
  assert.equal(manifest.state.public.timeline.stageId, "stage_intro");
});

test("validateGameManifest rejects a manifest without required fields", () => {
  assert.throws(
    () =>
      validateGameManifest({
        ...validManifest,
        meta: {
          version: "1.0.0",
          name: "Test",
          description: "Test",
          schemaVersion: "1.1"
          // missing required 'id'
        }
      }),
    ManifestValidationError
  );
});

test("validateGameManifest rejects actions with invalid handlerType", () => {
  assert.throws(
    () =>
      validateGameManifest({
        ...validManifest,
        actions: {
          openSharedGuidePanel: {
            handlerType: 123,
            capabilityFamily: "ui.panel",
            capability: "ui.panel.hint",
            function: "openSharedGuidePanel"
          }
        }
      }),
    ManifestValidationError
  );
});

test("validateGameManifest accepts deterministic execution mode without Agent Runtime", () => {
  const manifest = validateGameManifest({
    ...validManifest,
    executionMode: "deterministic"
  }) as unknown as typeof validManifest & { executionMode: string };

  assert.equal(manifest.executionMode, "deterministic");
});

test("validateGameManifest accepts AI-driven execution mode with Agent Runtime policy", () => {
  const manifest = validateGameManifest({
    ...validManifest,
    executionMode: "ai-driven",
    agentRuntime: {
      agentId: "scenario-agent",
      required: true,
      allowedCapabilities: ["advanceStep", "setMetric"],
      allowedTools: ["agent.nextTurn"],
      surfaceCatalog: ["cubica.choiceList", "cubica.metricsBar"],
      failurePolicy: "pause",
      contextExposurePolicy: {
        publicState: true,
        secretState: "none",
        manifestProjection: ["/meta", "/actions"]
      }
    }
  }) as unknown as typeof validManifest & { executionMode: string; agentRuntime: { failurePolicy: string } };

  assert.equal(manifest.executionMode, "ai-driven");
  assert.equal(manifest.agentRuntime.failurePolicy, "pause");
});

test("validateGameManifest accepts committed ai-driven-choice fixture", () => {
  const raw = readFileSync(path.join(repoRoot, "games", "ai-driven-choice", "game.manifest.json"), "utf8");
  const manifest = validateGameManifest(JSON.parse(raw)) as {
    meta: { id: string };
    executionMode?: string;
    agentRuntime?: { runtimeId?: string; failurePolicy?: string; surfaceCatalog?: string[] };
  };

  assert.equal(manifest.meta.id, "ai-driven-choice");
  assert.equal(manifest.executionMode, "ai-driven");
  assert.equal(manifest.agentRuntime?.runtimeId, "mock");
  assert.equal(manifest.agentRuntime?.failurePolicy, "pause");
  assert.deepEqual(manifest.agentRuntime?.surfaceCatalog, ["cubica.choiceList"]);
});

test("validateGameManifest rejects AI-driven execution mode without Agent Runtime", () => {
  assert.throws(
    () =>
      validateGameManifest({
        ...validManifest,
        executionMode: "ai-driven"
      }),
    ManifestValidationError
  );
});

test("validateGameManifest rejects required Agent Runtime without agent execution mode", () => {
  assert.throws(
    () =>
      validateGameManifest({
        ...validManifest,
        agentRuntime: {
          agentId: "scenario-agent",
          required: true,
          allowedCapabilities: ["advanceStep"],
          surfaceCatalog: ["cubica.choiceList"],
          failurePolicy: "pause"
        }
      }),
    ManifestValidationError
  );
});

test("validateGameManifest accepts Antarctica opening-tail info entries (i17-i21)", () => {
  const manifest = validateGameManifest({
    ...validManifest,
    content: {
      data: {
        infos: openingTailDataContent.infos,
        boards: [],
        cards: []
      }
    }
  }) as unknown as Record<string, unknown>;

  const data = manifest.content as { data?: { infos: unknown[] } };
  assert.equal(data?.data?.infos.length, 6);
});

test("validateGameManifest accepts Antarctica opening-tail board entries (55-60, 61-66, 67-68, 69-70)", () => {
  const manifest = validateGameManifest({
    ...validManifest,
    content: {
      data: {
        infos: [],
        boards: openingTailDataContent.boards,
        cards: []
      }
    }
  }) as unknown as Record<string, unknown>;

  const data = manifest.content as { data?: { boards: unknown[] } };
  assert.equal(data?.data?.boards.length, 4);
});

test("validateGameManifest accepts Antarctica opening-tail card entries (55-70)", () => {
  const manifest = validateGameManifest({
    ...validManifest,
    content: {
      data: {
        infos: [],
        boards: [],
        cards: openingTailDataContent.cards
      }
    }
  }) as unknown as Record<string, unknown>;

  const data = manifest.content as { data?: { cards: unknown[] } };
  assert.equal(data?.data?.cards.length, 16);
});

test("validateGameManifest accepts complete Antarctica opening-tail content (split boards 55-70, infos i17-i21)", () => {
  const manifest = validateGameManifest({
    ...validManifest,
    content: {
      data: openingTailDataContent
    }
  }) as unknown as Record<string, unknown>;

  const data = manifest.content as { data?: { infos: unknown[]; boards: unknown[]; cards: unknown[] } };
  assert.equal(data?.data?.infos.length, 6);
  assert.equal(data?.data?.boards.length, 4);
  assert.equal(data?.data?.cards.length, 16);
});

test("validateGameManifest rejects action entry with non-string handlerType in content actions", () => {
  assert.throws(
    () =>
      validateGameManifest({
        ...validManifest,
        content: {
          scenario: {
            path: "games/antarctica/scenario.json"
          }
        },
        actions: {
          badAction: {
            handlerType: 42
          }
        }
      }),
    ManifestValidationError
  );
});

test("validateGameManifest rejects deterministic action with missing required provenance item fields", () => {
  assert.throws(
    () =>
      validateGameManifest({
        ...validManifest,
        actions: {
          openSharedGuidePanel: {
            handlerType: "script",
            capabilityFamily: "ui.panel",
            capability: "ui.panel.hint",
            function: "openSharedGuidePanel",
            deterministic: {
              provenance: [
                { sourceKind: "legacy-opening-card" }
                // missing required 'sourceFile' and 'legacyCardId'
              ],
              guard: {},
              effects: [{ op: "log.append", kind: "test", summary: "test" }]
            }
          }
        }
      }),
    ManifestValidationError
  );
});

test("validateGameManifest rejects manifest with missing meta.id", () => {
  assert.throws(
    () =>
      validateGameManifest({
        ...validManifest,
        meta: {
          version: "1.0.0",
          name: "Test",
          description: "Test",
          schemaVersion: "1.1"
          // missing id
        }
      }),
    ManifestValidationError
  );
});

test("validateGameManifest rejects manifest with empty meta.schemaVersion", () => {
  assert.throws(
    () =>
      validateGameManifest({
        ...validManifest,
        meta: {
          ...validManifest.meta,
          schemaVersion: 42
        }
      }),
    ManifestValidationError
  );
});

test("validateGameManifest rejects manifest with invalid config.players.min as string", () => {
  assert.throws(
    () =>
      validateGameManifest({
        ...validManifest,
        config: {
          players: { min: "1", max: 1 },
          settings: { mode: "singleplayer", locale: "ru-RU" }
        }
      }),
    ManifestValidationError
  );
});

test("validateGameManifest rejects manifest with missing engine.systemPrompt", () => {
  assert.throws(
    () =>
      validateGameManifest({
        ...validManifest,
        engine: {}
      }),
    ManifestValidationError
  );
});

test("validateGameManifest rejects manifest with invalid state.public as non-object", () => {
  assert.throws(
    () =>
      validateGameManifest({
        ...validManifest,
        state: {
          public: "not-an-object"
        }
      }),
    ManifestValidationError
  );
});

test("validateGameManifest accepts deterministic action with empty provenance array", () => {
  const manifest = validateGameManifest({
    ...validManifest,
    actions: {
      openSharedGuidePanel: {
        handlerType: "script",
        capabilityFamily: "ui.panel",
        capability: "ui.panel.hint",
          function: "openSharedGuidePanel",
          deterministic: {
            provenance: [],
            guard: {},
            effects: [
              { op: "metric.add", metricId: "score", delta: 10 },
              { op: "log.append", kind: "test", summary: "test", auditMetrics: true }
            ]
          }
        }
      }
  }) as unknown as Record<string, unknown>;

  const actions = manifest.actions as Record<string, unknown>;
  assert.ok(actions?.openSharedGuidePanel);
});

test("validateGameManifest accepts manifest-declared UI effects", () => {
  const manifest = validateGameManifest({
    ...validManifest,
    actions: {
      openSharedGuidePanel: {
        handlerType: "manifest-data",
        capabilityFamily: "ui.panel",
        capability: "ui.panel.open",
        deterministic: {
          effects: [
            { op: "ui.panel.open", panelId: "hint" },
            { op: "log.append", kind: "ui-panel-open", summary: "Open shared guide panel" }
          ]
        }
      }
    }
  }) as unknown as Record<string, unknown>;

  const actions = manifest.actions as Record<string, unknown>;
  assert.ok(actions?.openSharedGuidePanel);
});

test("validateGameManifest accepts manifest-declared timeline effects", () => {
  const manifest = validateGameManifest({
    ...validManifest,
    actions: {
      advanceTimeline: {
        handlerType: "manifest-data",
        capabilityFamily: "game.timeline.advance",
        capability: "game.timeline.advance",
        deterministic: {
          effects: [
            {
              op: "timeline.set",
              canAdvance: false,
              stepIndex: 2,
              stageId: "stage_intro",
              screenId: "S1",
              activeInfoId: "i2"
            }
          ]
        }
      }
    }
  }) as unknown as Record<string, unknown>;

  const actions = manifest.actions as Record<string, unknown>;
  assert.ok(actions?.advanceTimeline);
});

test("validateGameManifest accepts object-state card effects with conditions", () => {
  const manifest = validateGameManifest({
    ...validManifest,
    objectModels: {
      "antarctica.card": {
        collection: "cards",
        idField: "id",
        scope: "session",
        facets: {
          selection: {
            initial: "idle",
            values: ["idle", "selected"]
          },
          resolution: {
            initial: "idle",
            values: ["idle", "resolved"]
          }
        }
      }
    },
    actions: {
      resolveCard: {
        handlerType: "manifest-data",
        capabilityFamily: "game.card.resolve",
        capability: "game.card.resolve",
        deterministic: {
          effects: [
            {
              op: "object.state.set",
              visibility: "public",
              collection: "cards",
              objectId: "1",
              facet: "selection",
              value: "selected"
            },
            {
              op: "object.state.set",
              visibility: "public",
              collection: "cards",
              objectId: "1",
              facet: "resolution",
              value: "resolved"
            },
            {
              op: "state.patch",
              patches: [{ op: "replace", path: "/secret/opening/selectedCardId", value: "1" }]
            },
            {
              op: "counter.add",
              path: "/public/teamSelection/pickCount",
              delta: 1
            },
            {
              op: "collection.append",
              path: "/public/teamSelection/selectedMemberIds",
              value: "fedya"
            },
            {
              op: "timeline.set",
              canAdvance: true,
              when: {
                collectionCount: {
                  path: "/public/objects/cards",
                  ids: ["1", "2", "3"],
                  field: "facets/resolution",
                  equals: "resolved",
                  countAtLeast: 2
                }
              }
            },
            {
              op: "timeline.set",
              activeInfoId: "i19_1",
              when: {
                metric: { metricId: "time", operator: "<", threshold: 54 },
                readFrom: "preAction"
              }
            }
          ]
        }
      }
    }
  }) as unknown as Record<string, unknown>;

  const actions = manifest.actions as Record<string, unknown>;
  assert.ok(actions?.resolveCard);
});

test("validateGameManifest rejects current manifests that still use guard.card", () => {
  assert.throws(
    () =>
      validateGameManifest({
        ...validManifest,
        actions: {
          resolveCard: {
            handlerType: "manifest-data",
            capabilityFamily: "game.card.resolve",
            capability: "game.card.resolve",
            deterministic: {
              guard: {
                card: { id: "1", selected: false, resolved: false }
              },
              effects: [
                {
                  op: "timeline.set",
                  canAdvance: true
                }
              ]
            }
          }
        }
      }),
    ManifestValidationError
  );
});

test("validateGameManifest rejects malformed manifest-declared UI effects", () => {
  assert.throws(
    () =>
      validateGameManifest({
        ...validManifest,
        actions: {
          openSharedGuidePanel: {
            handlerType: "manifest-data",
            capabilityFamily: "ui.panel",
            capability: "ui.panel.open",
            deterministic: {
              effects: [
                { op: "ui.panel.open" }
              ]
            }
          }
        }
      }),
    ManifestValidationError
  );
});

test("validateGameManifest rejects malformed manifest-declared timeline effects", () => {
  assert.throws(
    () =>
      validateGameManifest({
        ...validManifest,
        actions: {
          advanceTimeline: {
            handlerType: "manifest-data",
            capabilityFamily: "game.timeline.advance",
            capability: "game.timeline.advance",
            deterministic: {
              effects: [
                { op: "timeline.set", stepIndex: "not-a-template" }
              ]
            }
          }
        }
      }),
    ManifestValidationError
  );
});

test("validateGameManifest rejects empty timeline effects", () => {
  assert.throws(
    () =>
      validateGameManifest({
        ...validManifest,
        actions: {
          advanceTimeline: {
            handlerType: "manifest-data",
            capabilityFamily: "game.timeline.advance",
            capability: "game.timeline.advance",
            deterministic: {
              effects: [
                { op: "timeline.set" }
              ]
            }
          }
        }
      }),
    ManifestValidationError
  );
});

test("validateGameManifest rejects generic effects with unsafe write paths", () => {
  assert.throws(
    () =>
      validateGameManifest({
        ...validManifest,
        actions: {
          resolveCard: {
            handlerType: "manifest-data",
            capabilityFamily: "game.card.resolve",
            capability: "game.card.resolve",
            deterministic: {
              effects: [
                {
                  op: "state.patch",
                  patches: [{ op: "replace", path: "/runtime/internal", value: true }]
                }
              ]
            }
          }
        }
      }),
    ManifestValidationError
  );
});

test("validateGameManifest rejects flag effects outside public flags", () => {
  assert.throws(
    () =>
      validateGameManifest({
        ...validManifest,
        actions: {
          resolveCard: {
            handlerType: "manifest-data",
            capabilityFamily: "game.card.resolve",
            capability: "game.card.resolve",
            deterministic: {
              effects: [
                {
                  op: "flag.set",
                  path: "/public/cards/1",
                  values: { resolved: true }
                }
              ]
            }
          }
        }
      }),
    ManifestValidationError
  );
});

test("validateGameManifest rejects deterministic action with invalid metric operator", () => {
  assert.throws(
    () =>
      validateGameManifest({
        ...validManifest,
        actions: {
          openSharedGuidePanel: {
            handlerType: "script",
            capabilityFamily: "ui.panel",
            capability: "ui.panel.hint",
            function: "openSharedGuidePanel",
            deterministic: {
              provenance: [
                { sourceKind: "legacy-opening-card", sourceFile: "game.js", legacyCardId: "1" }
              ],
              guard: {
                timeline: { stepIndex: 5 }
              },
              effects: [
                {
                  op: "metric.add",
                  metricId: "score",
                  delta: 10,
                  when: { metric: { metricId: "score", operator: "!=", threshold: 50 } }
                }
              ]
            }
          }
        }
      }),
    ManifestValidationError
  );
});

test("validateGameManifest accepts team selection content under additionalProperties", () => {
  const manifest = validateGameManifest({
    ...validManifest,
    content: {
      data: {
        infos: [],
        boards: [],
        teamSelections: [
          {
            id: "opening.team.selection",
            stepIndex: 15,
            screenId: "S2",
            title: "Test selection",
            body: "Test body",
            requiredPickCount: 5,
            confirmActionId: "opening.team.confirm",
            members: []
          }
        ],
        cards: []
      }
    }
  }) as unknown as Record<string, unknown>;

  const data = manifest.content as { data?: { teamSelections: unknown[] } };
  assert.equal(data?.data?.teamSelections.length, 1);
});

test("validateGameManifest accepts game-owned metric catalog", () => {
  const manifest = validateGameManifest({
    ...validManifest,
    content: {
      data: {
        rules: {
          dayLimit: 60
        },
        metrics: [
          {
            metricId: "time",
            label: "Прошло дней",
            kind: "state",
            statePath: "public.metrics.time"
          },
          {
            metricId: "remainingDays",
            label: "Осталось дней",
            kind: "computed",
            computed: {
              expression: {
                "-": [
                  { var: "content.rules.dayLimit" },
                  { var: "public.metrics.time" }
                ]
              }
            }
          }
        ]
      }
    }
  }) as unknown as { content?: { data?: { metrics?: Array<{ metricId: string }> } } };

  assert.deepEqual(
    manifest.content?.data?.metrics?.map((metric) => metric.metricId),
    ["time", "remainingDays"]
  );
});

test("validateGameManifest rejects computed metric without expression", () => {
  assert.throws(
    () =>
      validateGameManifest({
        ...validManifest,
        content: {
          data: {
            metrics: [
              {
                metricId: "remainingDays",
                label: "Осталось дней",
                kind: "computed",
                computed: {}
              }
            ]
          }
        }
      }),
    ManifestValidationError
  );
});

test("validateGameManifest rejects deterministic action with invalid conditional timeline stepIndex", () => {
  assert.throws(
    () =>
      validateGameManifest({
        ...validManifest,
        actions: {
          openSharedGuidePanel: {
            handlerType: "script",
            capabilityFamily: "ui.panel",
            capability: "ui.panel.hint",
            function: "openSharedGuidePanel",
            deterministic: {
              provenance: [
                { sourceKind: "legacy-opening-card", sourceFile: "game.js", legacyCardId: "1" }
              ],
              guard: {
                timeline: { stepIndex: 5 }
              },
              effects: [
                {
                  op: "timeline.set",
                  line: "main",
                  stepIndex: "not-a-number",
                  screenId: "S1",
                  when: { metric: { metricId: "score", operator: ">", threshold: 50 } }
                }
              ]
            }
          }
        }
      }),
    ManifestValidationError
  );
});

test("validateGameManifest rejects deterministic action with malformed guard.collectionCount", () => {
  // ADR-041 §7.2: the game-specific `board` guard was migrated onto the generic
  // `collectionCount` guard. A collectionCount missing required fields
  // (`field`/`countAtLeast`) must be rejected by the schema.
  assert.throws(
    () =>
      validateGameManifest({
        ...validManifest,
        actions: {
          openSharedGuidePanel: {
            handlerType: "script",
            capabilityFamily: "ui.panel",
            capability: "ui.panel.hint",
            function: "openSharedGuidePanel",
            deterministic: {
              provenance: [
                { sourceKind: "legacy-opening-card", sourceFile: "game.js", legacyCardId: "1" }
              ],
              guard: {
                collectionCount: {
                  path: "/public/objects/cards",
                  ids: ["1", "2"]
                }
              },
              effects: [{ op: "log.append", kind: "test", summary: "test" }]
            }
          }
        }
      }),
    ManifestValidationError
  );
});

test("validateGameManifest rejects deterministic action with invalid collection count threshold", () => {
  assert.throws(
    () =>
      validateGameManifest({
        ...validManifest,
        actions: {
          openSharedGuidePanel: {
            handlerType: "script",
            capabilityFamily: "ui.panel",
            capability: "ui.panel.hint",
            function: "openSharedGuidePanel",
            deterministic: {
              provenance: [
                { sourceKind: "legacy-opening-card", sourceFile: "game.js", legacyCardId: "1" }
              ],
              guard: {},
              effects: [
                {
                  op: "timeline.set",
                  canAdvance: true,
                  when: {
                    collectionCount: {
                      path: "/public/flags/cards",
                      ids: ["1", "2", "3"],
                      field: "resolved",
                      countAtLeast: "2"
                    }
                  }
                }
              ]
            }
          }
        }
      }),
    ManifestValidationError
  );
});

test("validateGameManifest rejects malformed content.scenario reference", () => {
  assert.throws(
    () =>
      validateGameManifest({
        ...validManifest,
        content: {
          scenario: {
            path: ["invalid", "path"]
          }
        }
      }),
    ManifestValidationError
  );
});

test("validateGameManifest rejects action referencing non-existent template", () => {
  assert.throws(
    () =>
      validateGameManifest({
        ...validManifest,
        templates: {
          "my-template": {
            deterministic: {
              guard: {},
              effects: [{ op: "log.append", kind: "test", summary: "test" }]
            }
          }
        },
        actions: {
          badAction: {
            handlerType: "manifest-data",
            templateId: "non-existent-template",
            capabilityFamily: "test",
            capability: "test.action",
            params: {}
          }
        }
      }),
    ManifestValidationError
  );
});

test("validateGameManifest accepts action referencing existing template", () => {
  const manifest = validateGameManifest({
    ...validManifest,
    templates: {
      "my-template": {
        deterministic: {
          guard: {},
          effects: [{ op: "log.append", kind: "test", summary: "test" }]
        }
      }
    },
    actions: {
      goodAction: {
        handlerType: "manifest-data",
        templateId: "my-template",
        capabilityFamily: "test",
        capability: "test.action",
        params: {}
      }
    }
  }) as unknown as Record<string, unknown>;

  const actions = manifest.actions as Record<string, unknown>;
  assert.ok(actions?.goodAction);
});
