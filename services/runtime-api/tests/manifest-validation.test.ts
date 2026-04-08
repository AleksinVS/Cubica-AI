import assert from "node:assert/strict";
import { test } from "node:test";

import { ManifestValidationError } from "../src/modules/errors.ts";
import { validateGameManifest } from "../src/modules/content/manifestValidation.ts";

const validManifest = {
  meta: {
    id: "antarctica",
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
      flags: { cards: {} }
    }
  },
  actions: {
    showHint: {
      handlerType: "script",
      capabilityFamily: "ui.panel",
      capability: "ui.panel.hint",
      function: "showHint"
    }
  }
};

// Antarctica player-facing content entries for boards 55-60, 61-66, 67-70 and infos i17-i21
const openingTailAntarcticaContent = {
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
      id: "opening.board.67_70",
      title: "Выберите двенадцатый шаг",
      body: "После переезда нужно укрепить позиции.",
      stepIndex: 34,
      screenId: "S2",
      cardIds: ["67", "68", "69", "70"]
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

  assert.equal(manifest.meta.id, "antarctica");
  assert.equal(manifest.state.public.timeline.stageId, "stage_intro");
});

test("validateGameManifest rejects a manifest without required fields", () => {
  assert.throws(
    () =>
      validateGameManifest({
        ...validManifest,
        meta: {
          ...validManifest.meta,
          name: ""
        }
      }),
    ManifestValidationError
  );
});

test("validateGameManifest rejects actions without capability metadata", () => {
  assert.throws(
    () =>
      validateGameManifest({
        ...validManifest,
        actions: {
          showHint: {
            handlerType: "script",
            function: "showHint"
          }
        }
      }),
    ManifestValidationError
  );
});

test("validateGameManifest accepts Antarctica opening-tail info entries (i17-i21)", () => {
  const manifest = validateGameManifest({
    ...validManifest,
    content: {
      antarctica: {
        infos: openingTailAntarcticaContent.infos,
        boards: [],
        cards: []
      }
    }
  }) as unknown as Record<string, unknown>;

  const antarctica = manifest.content as { antarctica?: { infos: unknown[] } };
  assert.equal(antarctica?.antarctica?.infos.length, 6);
});

test("validateGameManifest accepts Antarctica opening-tail board entries (55-60, 61-66, 67-70)", () => {
  const manifest = validateGameManifest({
    ...validManifest,
    content: {
      antarctica: {
        infos: [],
        boards: openingTailAntarcticaContent.boards,
        cards: []
      }
    }
  }) as unknown as Record<string, unknown>;

  const antarctica = manifest.content as { antarctica?: { boards: unknown[] } };
  assert.equal(antarctica?.antarctica?.boards.length, 3);
});

test("validateGameManifest accepts Antarctica opening-tail card entries (55-70)", () => {
  const manifest = validateGameManifest({
    ...validManifest,
    content: {
      antarctica: {
        infos: [],
        boards: [],
        cards: openingTailAntarcticaContent.cards
      }
    }
  }) as unknown as Record<string, unknown>;

  const antarctica = manifest.content as { antarctica?: { cards: unknown[] } };
  assert.equal(antarctica?.antarctica?.cards.length, 16);
});

test("validateGameManifest accepts complete Antarctica opening-tail content (boards 55-70, infos i17-i21)", () => {
  const manifest = validateGameManifest({
    ...validManifest,
    content: {
      antarctica: openingTailAntarcticaContent
    }
  }) as unknown as Record<string, unknown>;

  const antarctica = manifest.content as { antarctica?: { infos: unknown[]; boards: unknown[]; cards: unknown[] } };
  assert.equal(antarctica?.antarctica?.infos.length, 6);
  assert.equal(antarctica?.antarctica?.boards.length, 3);
  assert.equal(antarctica?.antarctica?.cards.length, 16);
});

test("validateGameManifest rejects board with missing required cardIds array", () => {
  assert.throws(
    () =>
      validateGameManifest({
        ...validManifest,
        content: {
          antarctica: {
            infos: [],
            boards: [
              {
                id: "opening.board.55_60",
                title: "Test board",
                stepIndex: 30,
                screenId: "S2"
                // missing cardIds
              }
            ],
            cards: []
          }
        }
      }),
    ManifestValidationError
  );
});

test("validateGameManifest rejects info entry with missing advanceActionId", () => {
  assert.throws(
    () =>
      validateGameManifest({
        ...validManifest,
        content: {
          antarctica: {
            infos: [
              {
                id: "i17",
                stepIndex: 31,
                screenId: "S1",
                title: "Test info",
                body: "Test body"
                // missing advanceActionId
              }
            ],
            boards: [],
            cards: []
          }
        }
      }),
    ManifestValidationError
  );
});

test("validateGameManifest rejects card entry with missing selectActionId", () => {
  assert.throws(
    () =>
      validateGameManifest({
        ...validManifest,
        content: {
          antarctica: {
            infos: [],
            boards: [],
            cards: [
              {
                cardId: "55",
                title: "Test card",
                summary: "Test summary"
                // missing selectActionId
              }
            ]
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
          schemaVersion: ""
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

test("validateGameManifest rejects manifest with invalid state.public.timeline", () => {
  assert.throws(
    () =>
      validateGameManifest({
        ...validManifest,
        state: {
          public: {
            timeline: {
              line: "main"
              // missing stepIndex, stageId, screenId
            },
            log: [],
            flags: { cards: {} }
          }
        }
      }),
    ManifestValidationError
  );
});

test("validateGameManifest rejects deterministic action with empty provenance array", () => {
  assert.throws(
    () =>
      validateGameManifest({
        ...validManifest,
        actions: {
          showHint: {
            handlerType: "script",
            capabilityFamily: "ui.panel",
            capability: "ui.panel.hint",
            function: "showHint",
            deterministic: {
              provenance: [],
              guard: {},
              metricDeltas: [{ metricId: "score", delta: 10 }],
              log: { kind: "test", summary: "test" },
              stateUpdate: {}
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
          showHint: {
            handlerType: "script",
            capabilityFamily: "ui.panel",
            capability: "ui.panel.hint",
            function: "showHint",
            deterministic: {
              provenance: [
                { sourceKind: "legacy-opening-card", sourceFile: "game.js", legacyCardId: "1" }
              ],
              guard: {
                timeline: { stepIndex: 5 }
              },
              metricDeltas: [{ metricId: "score", delta: 10 }],
              conditionalMetricBonuses: [
                {
                  when: { metricId: "score", operator: "!=", threshold: 50 },
                  metricDeltas: [{ metricId: "score", delta: 5 }]
                }
              ],
              log: { kind: "test", summary: "test" },
              stateUpdate: {}
            }
          }
        }
      }),
    ManifestValidationError
  );
});

test("validateGameManifest rejects team selection scene with missing requiredPickCount", () => {
  assert.throws(
    () =>
      validateGameManifest({
        ...validManifest,
        content: {
          antarctica: {
            infos: [],
            boards: [],
            teamSelections: [
              {
                id: "opening.team.selection",
                stepIndex: 15,
                screenId: "S2",
                title: "Test selection",
                body: "Test body",
                // missing requiredPickCount
                confirmActionId: "opening.team.confirm",
                members: []
              }
            ],
            cards: []
          }
        }
      }),
    ManifestValidationError
  );
});

test("validateGameManifest rejects deterministic action with invalid conditionalLineSwitch targetStepIndex", () => {
  assert.throws(
    () =>
      validateGameManifest({
        ...validManifest,
        actions: {
          showHint: {
            handlerType: "script",
            capabilityFamily: "ui.panel",
            capability: "ui.panel.hint",
            function: "showHint",
            deterministic: {
              provenance: [
                { sourceKind: "legacy-opening-card", sourceFile: "game.js", legacyCardId: "1" }
              ],
              guard: {
                timeline: { stepIndex: 5 }
              },
              metricDeltas: [{ metricId: "score", delta: 10 }],
              conditionalLineSwitch: {
                when: { metricId: "score", operator: ">", threshold: 50 },
                targetLine: "main",
                targetStepIndex: "not-a-number",
                targetScreenId: "S1"
              },
              log: { kind: "test", summary: "test" },
              stateUpdate: {}
            }
          }
        }
      }),
    ManifestValidationError
  );
});

test("validateGameManifest rejects deterministic action with malformed guard.board.cardIds", () => {
  assert.throws(
    () =>
      validateGameManifest({
        ...validManifest,
        actions: {
          showHint: {
            handlerType: "script",
            capabilityFamily: "ui.panel",
            capability: "ui.panel.hint",
            function: "showHint",
            deterministic: {
              provenance: [
                { sourceKind: "legacy-opening-card", sourceFile: "game.js", legacyCardId: "1" }
              ],
              guard: {
                board: {
                  cardIds: ["1", 2, "3"]
                }
              },
              metricDeltas: [{ metricId: "score", delta: 10 }],
              log: { kind: "test", summary: "test" },
              stateUpdate: {}
            }
          }
        }
      }),
    ManifestValidationError
  );
});

test("validateGameManifest rejects deterministic action with boardThreshold resolvedCountAtLeast as string", () => {
  assert.throws(
    () =>
      validateGameManifest({
        ...validManifest,
        actions: {
          showHint: {
            handlerType: "script",
            capabilityFamily: "ui.panel",
            capability: "ui.panel.hint",
            function: "showHint",
            deterministic: {
              provenance: [
                { sourceKind: "legacy-opening-card", sourceFile: "game.js", legacyCardId: "1" }
              ],
              guard: {},
              metricDeltas: [{ metricId: "score", delta: 10 }],
              log: { kind: "test", summary: "test" },
              stateUpdate: {
                boardThreshold: {
                  cardIds: ["1", "2", "3"],
                  resolvedCountAtLeast: "2"
                }
              }
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
