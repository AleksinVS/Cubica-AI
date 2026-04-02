/**
 * Test fixtures for Antarctica opening-tail player-web slices (steps 30-31).
 *
 * Covers:
 * - Board 55_60 (stepIndex 30) with cards 55-60
 * - Info i17 (stepIndex 31) follow-up after go-card advance
 *
 * These fixtures are used by antarctica-player.test.tsx to verify
 * that the player-web correctly renders the step-30 acceleration board
 * and the explicit i17 follow-up from the frozen player-content DTO.
 */

import type {
  AntarcticaPlayerBoard,
  AntarcticaPlayerBoardCard,
  AntarcticaPlayerContent,
  AntarcticaPlayerInfoEntry,
  PlayerFacingContent,
} from "@cubica/contracts-manifest";
import type { SessionSnapshot } from "@/lib/antarctica";

/** Antarctica player-facing content for steps 30-31 (board 55_60 and info i17) */
export const openingTailStep30AntarcticaContent: AntarcticaPlayerContent = {
  infos: [
    {
      id: "i17",
      stepIndex: 31,
      screenId: "S1",
      title: "Ускорение процесса",
      body: "Настало время ускорить процесс переезда.",
      advanceActionId: "opening.info.i17.advance",
      advanceLabel: "Продолжить",
    },
  ],
  boards: [
    {
      id: "opening.board.55_60",
      title: "Выберите десятый шаг",
      body: "Теперь у вас есть еще несколько способов продолжить работу штаба.",
      stepIndex: 30,
      screenId: "S2",
      cardIds: ["55", "56", "57", "58", "59", "60"],
    },
  ],
  cards: [
    {
      cardId: "55",
      title: "Привлечь скептиков",
      summary: "Детали переезда убедят скептиков.",
      selectActionId: "opening.card.55",
      selectLabel: "Выбрать",
      advanceActionId: "opening.card.55.advance",
      advanceLabel: "Продолжить",
    },
    {
      cardId: "56",
      title: "Нейтрализовать Григория",
      summary: "Помощник Григория поможет.",
      selectActionId: "opening.card.56",
      selectLabel: "Выбрать",
    },
    {
      cardId: "57",
      title: "Поговорить с детьми",
      summary: "Дети - наша надежда.",
      selectActionId: "opening.card.57",
      selectLabel: "Выбрать",
      advanceActionId: "opening.card.57.advance",
      advanceLabel: "Продолжить",
    },
    {
      cardId: "58",
      title: "Семейные ужины",
      summary: "Ужины укрепляют семью.",
      selectActionId: "opening.card.58",
      selectLabel: "Выбрать",
      advanceActionId: "opening.card.58.advance",
      advanceLabel: "Продолжить",
    },
    {
      cardId: "59",
      title: "Усилить участие",
      summary: "Команда изменений усиливает позиции.",
      selectActionId: "opening.card.59",
      selectLabel: "Выбрать",
    },
    {
      cardId: "60",
      title: "Школа разведчика",
      summary: "Обучение разведчиков.",
      selectActionId: "opening.card.60",
      selectLabel: "Выбрать",
      advanceActionId: "opening.card.60.advance",
      advanceLabel: "Продолжить",
    },
  ],
};

/** Full player-facing content DTO with Antarctica opening-tail data */
export const openingTailStep30PlayerContent: PlayerFacingContent = {
  gameId: "antarctica",
  version: "1.0.0",
  name: "Antarctica",
  description: "Antarctica scenario - opening tail",
  locale: "ru-RU",
  playerConfig: { min: 1, max: 1 },
  actions: [
    {
      actionId: "opening.card.55",
      displayName: "Привлечь скептиков",
      capabilityFamily: "board",
      capability: "card.select",
    },
    {
      actionId: "opening.card.55.advance",
      displayName: "Продолжить",
      capabilityFamily: "board",
      capability: "card.advance",
    },
  ],
  mockups: [],
  antarctica: openingTailStep30AntarcticaContent,
};

/** Session snapshot at step 30 showing board 55_60 with no card selected yet */
export const openingTailStep30SessionSnapshot: SessionSnapshot = {
  sessionId: "test-session-step30",
  playerId: "player-web",
  state: {
    public: {
      timeline: {
        line: "main",
        stepIndex: 30,
        stageId: "opening",
        screenId: "S2",
        canAdvance: false,
      },
      flags: {
        cards: {},
      },
      log: [],
    },
  },
} as unknown as SessionSnapshot;

/** Session snapshot at step 30 after selecting go-card 55 */
export const openingTailStep30WithSelectedCardSessionSnapshot: SessionSnapshot = {
  sessionId: "test-session-step30-selected",
  playerId: "player-web",
  state: {
    public: {
      timeline: {
        line: "main",
        stepIndex: 30,
        stageId: "opening",
        screenId: "S2",
        canAdvance: true,
      },
      flags: {
        cards: {
          "55": { selected: true, resolved: false, locked: false, available: true },
        },
      },
      log: [],
    },
    secret: {
      opening: {
        selectedCardId: "55",
      },
    },
  },
} as unknown as SessionSnapshot;

/** Session snapshot at step 31 showing info i17 after go-card advance */
export const openingTailStep31InfoSessionSnapshot: SessionSnapshot = {
  sessionId: "test-session-step31-info",
  playerId: "player-web",
  state: {
    public: {
      timeline: {
        line: "main",
        stepIndex: 31,
        stageId: "opening",
        screenId: "S1",
        activeInfoId: "i17",
        canAdvance: false,
      },
      flags: {
        cards: {
          "55": { selected: true, resolved: true, locked: false, available: true },
        },
      },
      log: [],
    },
  },
} as unknown as SessionSnapshot;

/**
 * Antarctica player-facing content for steps 32-33 (board 61_66 and info i18).
 *
 * Covers:
 * - Board 61_66 (stepIndex 32) with cards 61-66
 * - Info i18 (stepIndex 33) follow-up after go-card advance
 * - Card 66 is a locked go-card that requires cards 62/63 to be resolved first
 *
 * These fixtures are used by antarctica-player.test.tsx to verify
 * that the player-web correctly renders the step-32 scout-dispatch board
 * with locked-card state and the explicit i18 follow-up from the frozen
 * player-content DTO.
 */

/** Antarctica player-facing content for steps 32-33 (board 61_66 and info i18) */
export const openingTailStep32AntarcticaContent: AntarcticaPlayerContent = {
  infos: [
    {
      id: "i18",
      stepIndex: 33,
      screenId: "S1",
      title: "Скауты отправлены",
      body: "Группа разведчиков успешно отправлена на поиск нового места.",
      advanceActionId: "opening.info.i18.advance",
      advanceLabel: "Продолжить",
    },
  ],
  boards: [
    {
      id: "opening.board.61_66",
      title: "Выберите способ отправки",
      body: "Теперь вы можете отправить группу скаутов.",
      stepIndex: 32,
      screenId: "S2",
      cardIds: ["61", "62", "63", "64", "65", "66"],
    },
  ],
  cards: [
    {
      cardId: "61",
      title: "Отправить разведчиков",
      summary: "Быстрая группа для разведки местности.",
      selectActionId: "opening.card.61",
      selectLabel: "Выбрать",
      advanceActionId: "opening.card.61.advance",
      advanceLabel: "Продолжить",
    },
    {
      cardId: "62",
      title: "Подготовить снаряжение",
      summary: "Снаряжение для долгой экспедиции.",
      selectActionId: "opening.card.62",
      selectLabel: "Выбрать",
    },
    {
      cardId: "63",
      title: "Организовать лагерь",
      summary: "Базовый лагерь для экспедиции.",
      selectActionId: "opening.card.63",
      selectLabel: "Выбрать",
    },
    {
      cardId: "64",
      title: "Нанять проводника",
      summary: "Местный проводник знает дорогу.",
      selectActionId: "opening.card.64",
      selectLabel: "Выбрать",
    },
    {
      cardId: "65",
      title: "Загрузить припасы",
      summary: "Провиант и оборудование для группы.",
      selectActionId: "opening.card.65",
      selectLabel: "Выбрать",
    },
    {
      cardId: "66",
      title: "Отправить экспедицию",
      summary: "Полная экспедиция на новое место.",
      selectActionId: "opening.card.66",
      selectLabel: "Выбрать",
      advanceActionId: "opening.card.66.advance",
      advanceLabel: "Продолжить",
    },
  ],
};

/** Full player-facing content DTO with Antarctica opening-tail data for steps 32-33 */
export const openingTailStep32PlayerContent: PlayerFacingContent = {
  gameId: "antarctica",
  version: "1.0.0",
  name: "Antarctica",
  description: "Antarctica scenario - opening tail (steps 32-33)",
  locale: "ru-RU",
  playerConfig: { min: 1, max: 1 },
  actions: [
    {
      actionId: "opening.card.61",
      displayName: "Отправить разведчиков",
      capabilityFamily: "board",
      capability: "card.select",
    },
    {
      actionId: "opening.card.61.advance",
      displayName: "Продолжить",
      capabilityFamily: "board",
      capability: "card.advance",
    },
  ],
  mockups: [],
  antarctica: openingTailStep32AntarcticaContent,
};

/** Session snapshot at step 32 showing board 61_66 with card 66 locked initially */
export const openingTailStep32BoardSessionSnapshot: SessionSnapshot = {
  sessionId: "test-session-step32-board",
  playerId: "player-web",
  state: {
    public: {
      timeline: {
        line: "main",
        stepIndex: 32,
        stageId: "opening",
        screenId: "S2",
        canAdvance: false,
      },
      flags: {
        cards: {
          // Card 66 starts locked - unlocked through board-local hook on cards 62/63
          "66": { selected: false, resolved: false, locked: true, available: true },
        },
      },
      log: [],
    },
  },
} as unknown as SessionSnapshot;

/** Session snapshot at step 32 after selecting go-card 61 */
export const openingTailStep32WithSelectedGoCard61SessionSnapshot: SessionSnapshot = {
  sessionId: "test-session-step32-selected-61",
  playerId: "player-web",
  state: {
    public: {
      timeline: {
        line: "main",
        stepIndex: 32,
        stageId: "opening",
        screenId: "S2",
        canAdvance: true,
      },
      flags: {
        cards: {
          "61": { selected: true, resolved: false, locked: false, available: true },
        },
      },
      log: [],
    },
    secret: {
      opening: {
        selectedCardId: "61",
      },
    },
  },
} as unknown as SessionSnapshot;

/** Session snapshot at step 32 after resolving cards 62/63 which unlocks card 66 */
export const openingTailStep32WithUnlockedCard66SessionSnapshot: SessionSnapshot = {
  sessionId: "test-session-step32-unlocked-66",
  playerId: "player-web",
  state: {
    public: {
      timeline: {
        line: "main",
        stepIndex: 32,
        stageId: "opening",
        screenId: "S2",
        canAdvance: false,
      },
      flags: {
        cards: {
          // Cards 62/63 resolved - unlocks card 66 via board-local hook
          "62": { selected: false, resolved: true, locked: false, available: true },
          "63": { selected: false, resolved: true, locked: false, available: true },
          "66": { selected: false, resolved: false, locked: false, available: true },
        },
      },
      log: [],
    },
  },
} as unknown as SessionSnapshot;

/** Session snapshot at step 32 after selecting locked go-card 66 (it was unlocked) */
export const openingTailStep32WithSelectedGoCard66SessionSnapshot: SessionSnapshot = {
  sessionId: "test-session-step32-selected-66",
  playerId: "player-web",
  state: {
    public: {
      timeline: {
        line: "main",
        stepIndex: 32,
        stageId: "opening",
        screenId: "S2",
        canAdvance: true,
      },
      flags: {
        cards: {
          "62": { selected: false, resolved: true, locked: false, available: true },
          "63": { selected: false, resolved: true, locked: false, available: true },
          "66": { selected: true, resolved: false, locked: false, available: true },
        },
      },
      log: [],
    },
    secret: {
      opening: {
        selectedCardId: "66",
      },
    },
  },
} as unknown as SessionSnapshot;

/** Session snapshot at step 33 showing info i18 after go-card advance */
export const openingTailStep33InfoSessionSnapshot: SessionSnapshot = {
  sessionId: "test-session-step33-info",
  playerId: "player-web",
  state: {
    public: {
      timeline: {
        line: "main",
        stepIndex: 33,
        stageId: "opening",
        screenId: "S1",
        activeInfoId: "i18",
        canAdvance: false,
      },
      flags: {
        cards: {
          "61": { selected: true, resolved: true, locked: false, available: true },
        },
      },
      log: [],
    },
  },
} as unknown as SessionSnapshot;

/**
 * Antarctica player-facing content for steps 34-38 (board 67_70, infos i19/i19_1, i20, i21).
 *
 * Covers:
 * - Board 67_70 (stepIndex 34) with cards 67-70
 * - Info i19 (stepIndex 35, screenId S1) - default relocation aftermath
 * - Info i19_1 (stepIndex 35, screenId S1) - fast-variant relocation aftermath
 * - Info i20 (stepIndex 37, screenId S1) - second relocation
 * - Info i21 (stepIndex 38, screenId S1) - terminal ending
 *
 * These fixtures are used by antarctica-player.test.tsx to verify
 * that the player-web correctly renders the step-34 aftermath board,
 * the i19/i19_1 variant routing based on activeInfoId from runtime state,
 * the i20 follow-up, and the terminal i21 ending.
 */

/** Antarctica player-facing content for steps 34-38 (board 67_70 and infos i19/i19_1, i20, i21) */
export const openingTailStep34AntarcticaContent: AntarcticaPlayerContent = {
  infos: [
    {
      id: "i19",
      stepIndex: 35,
      screenId: "S1",
      title: "Последствия переезда",
      body: "После переезда команда оказалась на новом месте.",
      advanceActionId: "opening.info.i19.advance",
      advanceLabel: "Продолжить",
    },
    {
      id: "i19_1",
      stepIndex: 35,
      screenId: "S1",
      title: "Быстрый переезд",
      body: "Команда быстро перебралась на новое место.",
      advanceActionId: "opening.info.i19.advance",
      advanceLabel: "Продолжить",
    },
    {
      id: "i20",
      stepIndex: 37,
      screenId: "S1",
      title: "Второй переезд",
      body: "Настало время для второго этапа переезда.",
      advanceActionId: "opening.info.i20.advance",
      advanceLabel: "Завершить",
    },
    {
      id: "i21",
      stepIndex: 38,
      screenId: "S1",
      title: "Финал",
      body: "История Antarctica подошла к концу.",
      advanceActionId: "",
      advanceLabel: "",
    },
  ],
  boards: [
    {
      id: "opening.board.67_70",
      title: "Выберите финальный шаг",
      body: "Теперь вам предстоит сделать последний выбор.",
      stepIndex: 34,
      screenId: "S2",
      cardIds: ["67", "68", "69", "70"],
    },
  ],
  cards: [
    {
      cardId: "67",
      title: "Организовать лагерь",
      summary: "Лагерь на новом месте.",
      selectActionId: "opening.card.67",
      selectLabel: "Выбрать",
    },
    {
      cardId: "68",
      title: "Быстрый переезд",
      summary: "Быстрое перемещение на новое место.",
      selectActionId: "opening.card.68",
      selectLabel: "Выбрать",
      advanceActionId: "opening.card.68.advance",
      advanceLabel: "Продолжить",
    },
    {
      cardId: "69",
      title: "Осмотр территории",
      summary: "Осмотр новой территории.",
      selectActionId: "opening.card.69",
      selectLabel: "Выбрать",
      advanceActionId: "opening.card.69.advance",
      advanceLabel: "Продолжить",
    },
    {
      cardId: "70",
      title: "Подготовка к зиме",
      summary: "Подготовка команды к зимнему сезону.",
      selectActionId: "opening.card.70",
      selectLabel: "Выбрать",
    },
  ],
};

/** Full player-facing content DTO with Antarctica opening-tail data for steps 34-38 */
export const openingTailStep34PlayerContent: PlayerFacingContent = {
  gameId: "antarctica",
  version: "1.0.0",
  name: "Antarctica",
  description: "Antarctica scenario - opening tail (steps 34-38)",
  locale: "ru-RU",
  playerConfig: { min: 1, max: 1 },
  actions: [
    {
      actionId: "opening.card.68",
      displayName: "Быстрый переезд",
      capabilityFamily: "board",
      capability: "card.select",
    },
    {
      actionId: "opening.card.68.advance",
      displayName: "Продолжить",
      capabilityFamily: "board",
      capability: "card.advance",
    },
    {
      actionId: "opening.card.69",
      displayName: "Осмотр территории",
      capabilityFamily: "board",
      capability: "card.select",
    },
    {
      actionId: "opening.card.69.advance",
      displayName: "Продолжить",
      capabilityFamily: "board",
      capability: "card.advance",
    },
  ],
  mockups: [],
  antarctica: openingTailStep34AntarcticaContent,
};

/** Session snapshot at step 34 showing board 67_70 */
export const openingTailStep34BoardSessionSnapshot: SessionSnapshot = {
  sessionId: "test-session-step34-board",
  playerId: "player-web",
  state: {
    public: {
      timeline: {
        line: "main",
        stepIndex: 34,
        stageId: "opening",
        screenId: "S2",
        canAdvance: false,
      },
      flags: {
        cards: {},
      },
      log: [],
    },
  },
} as unknown as SessionSnapshot;

/** Session snapshot at step 34 after selecting go-card 68 (fast variant) */
export const openingTailStep34WithSelectedGoCard68SessionSnapshot: SessionSnapshot = {
  sessionId: "test-session-step34-selected-68",
  playerId: "player-web",
  state: {
    public: {
      timeline: {
        line: "main",
        stepIndex: 34,
        stageId: "opening",
        screenId: "S2",
        canAdvance: true,
      },
      flags: {
        cards: {
          "68": { selected: true, resolved: false, locked: false, available: true },
        },
      },
      log: [],
    },
    secret: {
      opening: {
        selectedCardId: "68",
      },
    },
  },
} as unknown as SessionSnapshot;

/** Session snapshot at step 35 showing info i19 (default variant) after go-card 68 advance */
export const openingTailStep35InfoI19SessionSnapshot: SessionSnapshot = {
  sessionId: "test-session-step35-i19",
  playerId: "player-web",
  state: {
    public: {
      timeline: {
        line: "main",
        stepIndex: 35,
        stageId: "opening",
        screenId: "S1",
        activeInfoId: "i19",
        canAdvance: false,
      },
      flags: {
        cards: {
          "68": { selected: true, resolved: true, locked: false, available: true },
        },
      },
      log: [],
    },
  },
} as unknown as SessionSnapshot;

/** Session snapshot at step 35 showing info i19_1 (fast variant) after go-card 68 advance with high time */
export const openingTailStep35InfoI19_1SessionSnapshot: SessionSnapshot = {
  sessionId: "test-session-step35-i19_1",
  playerId: "player-web",
  state: {
    public: {
      timeline: {
        line: "main",
        stepIndex: 35,
        stageId: "opening",
        screenId: "S1",
        activeInfoId: "i19_1",
        canAdvance: false,
      },
      flags: {
        cards: {
          "68": { selected: true, resolved: true, locked: false, available: true },
        },
      },
      log: [],
    },
  },
} as unknown as SessionSnapshot;

/** Session snapshot at step 36 showing board 69_70 after i19 advance */
export const openingTailStep36BoardSessionSnapshot: SessionSnapshot = {
  sessionId: "test-session-step36-board",
  playerId: "player-web",
  state: {
    public: {
      timeline: {
        line: "main",
        stepIndex: 36,
        stageId: "opening",
        screenId: "S2",
        canAdvance: false,
      },
      flags: {
        cards: {
          "68": { selected: true, resolved: true, locked: false, available: true },
        },
      },
      log: [],
    },
  },
} as unknown as SessionSnapshot;

/** Session snapshot at step 36 after selecting go-card 69 */
export const openingTailStep36WithSelectedGoCard69SessionSnapshot: SessionSnapshot = {
  sessionId: "test-session-step36-selected-69",
  playerId: "player-web",
  state: {
    public: {
      timeline: {
        line: "main",
        stepIndex: 36,
        stageId: "opening",
        screenId: "S2",
        canAdvance: true,
      },
      flags: {
        cards: {
          "68": { selected: true, resolved: true, locked: false, available: true },
          "69": { selected: true, resolved: false, locked: false, available: true },
        },
      },
      log: [],
    },
    secret: {
      opening: {
        selectedCardId: "69",
      },
    },
  },
} as unknown as SessionSnapshot;

/** Session snapshot at step 37 showing info i20 after go-card 69 advance */
export const openingTailStep37InfoI20SessionSnapshot: SessionSnapshot = {
  sessionId: "test-session-step37-i20",
  playerId: "player-web",
  state: {
    public: {
      timeline: {
        line: "main",
        stepIndex: 37,
        stageId: "opening",
        screenId: "S1",
        activeInfoId: "i20",
        canAdvance: false,
      },
      flags: {
        cards: {
          "68": { selected: true, resolved: true, locked: false, available: true },
          "69": { selected: true, resolved: true, locked: false, available: true },
        },
      },
      log: [],
    },
  },
} as unknown as SessionSnapshot;

/** Session snapshot at step 38 showing terminal info i21 after i20 advance */
export const openingTailStep38InfoI21SessionSnapshot: SessionSnapshot = {
  sessionId: "test-session-step38-i21",
  playerId: "player-web",
  state: {
    public: {
      timeline: {
        line: "main",
        stepIndex: 38,
        stageId: "opening",
        screenId: "S1",
        activeInfoId: "i21",
        canAdvance: false,
      },
      flags: {
        cards: {
          "68": { selected: true, resolved: true, locked: false, available: true },
          "69": { selected: true, resolved: true, locked: false, available: true },
        },
      },
      log: [],
    },
  },
} as unknown as SessionSnapshot;
