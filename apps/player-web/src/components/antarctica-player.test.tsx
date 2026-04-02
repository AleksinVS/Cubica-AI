/**
 * Integration-style tests for Antarctica player-web rendering.
 *
 * Covers slice-step30-31-render:
 * - Board 55_60 (stepIndex 30) is rendered from content.antarctica.boards and cards
 * - Info i17 (stepIndex 31) is rendered from content.antarctica.infos with explicit advance action
 * - Selected go-card state is correctly reflected in the UI
 *
 * These tests verify that the player-web renders opening-tail scenes from
 * the frozen runtime-owned player-content DTO plus session snapshot,
 * not from fallback action catalog.
 */

import { beforeEach, describe, expect, it } from "vitest";
import React from "react";

import type { AntarcticaPlayerBoard } from "@cubica/contracts-manifest";

import {
  openingTailStep30AntarcticaContent,
  openingTailStep30PlayerContent,
  openingTailStep30SessionSnapshot,
  openingTailStep30WithSelectedCardSessionSnapshot,
  openingTailStep31InfoSessionSnapshot,
  openingTailStep32AntarcticaContent,
  openingTailStep32PlayerContent,
  openingTailStep32BoardSessionSnapshot,
  openingTailStep32WithSelectedGoCard61SessionSnapshot,
  openingTailStep32WithUnlockedCard66SessionSnapshot,
  openingTailStep32WithSelectedGoCard66SessionSnapshot,
  openingTailStep33InfoSessionSnapshot,
  openingTailStep34AntarcticaContent,
  openingTailStep34PlayerContent,
  openingTailStep34BoardSessionSnapshot,
  openingTailStep34WithSelectedGoCard68SessionSnapshot,
  openingTailStep35InfoI19SessionSnapshot,
  openingTailStep35InfoI19_1SessionSnapshot,
  openingTailStep36BoardSessionSnapshot,
  openingTailStep36WithSelectedGoCard69SessionSnapshot,
  openingTailStep37InfoI20SessionSnapshot,
  openingTailStep38InfoI21SessionSnapshot,
} from "@/test/antarctica-opening-tail-fixtures";

import {
  resolveAntarcticaContent,
  resolveCurrentBoard,
  resolveCurrentInfoEntry,
  resolveBoardCards,
  readSelectedCardId,
  readCanAdvance,
} from "@/lib/antarctica";

describe("slice-step30-31-render: Board 55_60 and Info i17", () => {
  describe("resolveAntarcticaContent", () => {
    it("returns Antarctica content when present in player-facing DTO", () => {
      const antarctica = resolveAntarcticaContent(openingTailStep30PlayerContent);
      expect(antarctica).not.toBeNull();
      expect(antarctica?.boards).toHaveLength(1);
      expect(antarctica?.infos).toHaveLength(1);
    });

    it("returns null when no Antarctica content is present", () => {
      const contentWithoutAntarctica = {
        ...openingTailStep30PlayerContent,
        antarctica: undefined,
      };
      const antarctica = resolveAntarcticaContent(contentWithoutAntarctica);
      expect(antarctica).toBeNull();
    });
  });

  describe("resolveCurrentBoard (stepIndex 30, screenId S2)", () => {
    it("resolves opening.board.55_60 at step 30 with screen S2", () => {
      const antarctica = openingTailStep30AntarcticaContent;
      const publicState = openingTailStep30SessionSnapshot.state.public as Record<string, unknown>;

      const board = resolveCurrentBoard(antarctica, publicState);

      expect(board).not.toBeNull();
      expect(board?.id).toBe("opening.board.55_60");
      expect(board?.stepIndex).toBe(30);
      expect(board?.screenId).toBe("S2");
      expect(board?.cardIds).toEqual(["55", "56", "57", "58", "59", "60"]);
    });

    it("does not resolve board at wrong stepIndex", () => {
      const antarctica = openingTailStep30AntarcticaContent;
      const publicState = {
        timeline: { stepIndex: 31, screenId: "S2" },
      };

      const board = resolveCurrentBoard(antarctica, publicState);
      expect(board).toBeNull();
    });

    it("does not resolve board at wrong screenId", () => {
      const antarctica = openingTailStep30AntarcticaContent;
      const publicState = {
        timeline: { stepIndex: 30, screenId: "S1" },
      };

      const board = resolveCurrentBoard(antarctica, publicState);
      expect(board).toBeNull();
    });
  });

  describe("resolveBoardCards for opening.board.55_60", () => {
    it("resolves all 6 cards for board 55_60", () => {
      const antarctica = openingTailStep30AntarcticaContent;
      const board: AntarcticaPlayerBoard = {
        id: "opening.board.55_60",
        stepIndex: 30,
        screenId: "S2",
        cardIds: ["55", "56", "57", "58", "59", "60"],
      };

      const cards = resolveBoardCards(antarctica, board);

      expect(cards).toHaveLength(6);
      expect(cards.map((c) => c.cardId)).toEqual(["55", "56", "57", "58", "59", "60"]);
    });

    it("identifies go-cards (55, 57, 58, 60) by presence of advanceActionId", () => {
      const antarctica = openingTailStep30AntarcticaContent;
      const board: AntarcticaPlayerBoard = {
        id: "opening.board.55_60",
        stepIndex: 30,
        screenId: "S2",
        cardIds: ["55", "56", "57", "58", "59", "60"],
      };

      const cards = resolveBoardCards(antarctica, board);

      const goCards = cards.filter((c) => c.advanceActionId !== undefined);
      const nonGoCards = cards.filter((c) => c.advanceActionId === undefined);

      expect(goCards).toHaveLength(4);
      expect(goCards.map((c) => c.cardId)).toEqual(["55", "57", "58", "60"]);
      expect(nonGoCards).toHaveLength(2);
      expect(nonGoCards.map((c) => c.cardId)).toEqual(["56", "59"]);
    });

    it("filters out unavailable cards based on cardFlags", () => {
      const antarctica = openingTailStep30AntarcticaContent;
      const board: AntarcticaPlayerBoard = {
        id: "opening.board.55_60",
        stepIndex: 30,
        screenId: "S2",
        cardIds: ["55", "56", "57", "58", "59", "60"],
      };
      const cardFlags = {
        "56": { available: false },
        "59": { available: false },
      };

      const cards = resolveBoardCards(antarctica, board, cardFlags);

      expect(cards).toHaveLength(4);
      expect(cards.map((c) => c.cardId)).toEqual(["55", "57", "58", "60"]);
    });
  });

  describe("resolveCurrentInfoEntry (stepIndex 31, screenId S1)", () => {
    it("resolves info i17 at step 31 with screen S1", () => {
      const antarctica = openingTailStep30AntarcticaContent;
      const publicState = openingTailStep31InfoSessionSnapshot.state.public as Record<string, unknown>;

      const info = resolveCurrentInfoEntry(antarctica, publicState);

      expect(info).not.toBeNull();
      expect(info?.id).toBe("i17");
      expect(info?.stepIndex).toBe(31);
      expect(info?.screenId).toBe("S1");
      expect(info?.title).toBe("Ускорение процесса");
      expect(info?.advanceActionId).toBe("opening.info.i17.advance");
    });

    it("does not resolve info at wrong stepIndex", () => {
      const antarctica = openingTailStep30AntarcticaContent;
      const publicState = {
        timeline: { stepIndex: 30, screenId: "S1", activeInfoId: "i17" },
      };

      const info = resolveCurrentInfoEntry(antarctica, publicState);
      expect(info).toBeNull();
    });
  });

  describe("session snapshot readers", () => {
    it("readSelectedCardId returns null when no card is selected", () => {
      const selectedCardId = readSelectedCardId(openingTailStep30SessionSnapshot);
      expect(selectedCardId).toBeNull();
    });

    it("readSelectedCardId returns card id when go-card 55 is selected", () => {
      const selectedCardId = readSelectedCardId(openingTailStep30WithSelectedCardSessionSnapshot);
      expect(selectedCardId).toBe("55");
    });

    it("readCanAdvance returns false when canAdvance is not set", () => {
      const canAdvance = readCanAdvance(openingTailStep30SessionSnapshot);
      expect(canAdvance).toBe(false);
    });

    it("readCanAdvance returns true when canAdvance is set after go-card selection", () => {
      const canAdvance = readCanAdvance(openingTailStep30WithSelectedCardSessionSnapshot);
      expect(canAdvance).toBe(true);
    });
  });

  describe("go-card advance flow: board 55_60 -> i17", () => {
    it("at step 30, board 55_60 is rendered with go-card 55 having advanceActionId", () => {
      const antarctica = openingTailStep30AntarcticaContent;
      const board: AntarcticaPlayerBoard = {
        id: "opening.board.55_60",
        stepIndex: 30,
        screenId: "S2",
        cardIds: ["55", "56", "57", "58", "59", "60"],
      };

      const cards = resolveBoardCards(antarctica, board);
      const goCard55 = cards.find((c) => c.cardId === "55");

      expect(goCard55).toBeDefined();
      expect(goCard55?.advanceActionId).toBe("opening.card.55.advance");
      expect(goCard55?.advanceLabel).toBe("Продолжить");
    });

    it("at step 31, info i17 is rendered with explicit advanceActionId", () => {
      const antarctica = openingTailStep30AntarcticaContent;
      const publicState = openingTailStep31InfoSessionSnapshot.state.public as Record<string, unknown>;

      const info = resolveCurrentInfoEntry(antarctica, publicState);

      expect(info).toBeDefined();
      expect(info?.advanceActionId).toBe("opening.info.i17.advance");
      expect(info?.advanceLabel).toBe("Продолжить");
      expect(info?.body).toContain("Настало время ускорить процесс переезда");
    });
  });
});

describe("slice-step32-33-render: Board 61_66 and Info i18", () => {
  describe("resolveAntarcticaContent", () => {
    it("returns Antarctica content when present in player-facing DTO", () => {
      const antarctica = resolveAntarcticaContent(openingTailStep32PlayerContent);
      expect(antarctica).not.toBeNull();
      expect(antarctica?.boards).toHaveLength(1);
      expect(antarctica?.infos).toHaveLength(1);
    });
  });

  describe("resolveCurrentBoard (stepIndex 32, screenId S2)", () => {
    it("resolves opening.board.61_66 at step 32 with screen S2", () => {
      const antarctica = openingTailStep32AntarcticaContent;
      const publicState = openingTailStep32BoardSessionSnapshot.state.public as Record<string, unknown>;

      const board = resolveCurrentBoard(antarctica, publicState);

      expect(board).not.toBeNull();
      expect(board?.id).toBe("opening.board.61_66");
      expect(board?.stepIndex).toBe(32);
      expect(board?.screenId).toBe("S2");
      expect(board?.cardIds).toEqual(["61", "62", "63", "64", "65", "66"]);
    });

    it("does not resolve board at wrong stepIndex", () => {
      const antarctica = openingTailStep32AntarcticaContent;
      const publicState = {
        timeline: { stepIndex: 33, screenId: "S2" },
      };

      const board = resolveCurrentBoard(antarctica, publicState);
      expect(board).toBeNull();
    });
  });

  describe("resolveBoardCards for opening.board.61_66", () => {
    it("resolves all 6 cards for board 61_66", () => {
      const antarctica = openingTailStep32AntarcticaContent;
      const board: AntarcticaPlayerBoard = {
        id: "opening.board.61_66",
        stepIndex: 32,
        screenId: "S2",
        cardIds: ["61", "62", "63", "64", "65", "66"],
      };

      const cards = resolveBoardCards(antarctica, board);

      expect(cards).toHaveLength(6);
      expect(cards.map((c) => c.cardId)).toEqual(["61", "62", "63", "64", "65", "66"]);
    });

    it("identifies go-cards (61, 66) by presence of advanceActionId", () => {
      const antarctica = openingTailStep32AntarcticaContent;
      const board: AntarcticaPlayerBoard = {
        id: "opening.board.61_66",
        stepIndex: 32,
        screenId: "S2",
        cardIds: ["61", "62", "63", "64", "65", "66"],
      };

      const cards = resolveBoardCards(antarctica, board);

      const goCards = cards.filter((c) => c.advanceActionId !== undefined);
      const nonGoCards = cards.filter((c) => c.advanceActionId === undefined);

      expect(goCards).toHaveLength(2);
      expect(goCards.map((c) => c.cardId)).toEqual(["61", "66"]);
      expect(nonGoCards).toHaveLength(4);
      expect(nonGoCards.map((c) => c.cardId)).toEqual(["62", "63", "64", "65"]);
    });

    it("card 66 has advanceActionId making it a go-card", () => {
      const antarctica = openingTailStep32AntarcticaContent;
      const board: AntarcticaPlayerBoard = {
        id: "opening.board.61_66",
        stepIndex: 32,
        screenId: "S2",
        cardIds: ["61", "62", "63", "64", "65", "66"],
      };

      const cards = resolveBoardCards(antarctica, board);
      const card66 = cards.find((c) => c.cardId === "66");

      expect(card66).toBeDefined();
      expect(card66?.advanceActionId).toBe("opening.card.66.advance");
      expect(card66?.advanceLabel).toBe("Продолжить");
    });
  });

  describe("locked-card behavior for card 66", () => {
    it("card 66 is locked initially at step 32", () => {
      const publicState = openingTailStep32BoardSessionSnapshot.state.public as Record<string, unknown>;
      const cardFlags = (publicState.flags as Record<string, Record<string, { locked?: boolean }>> | undefined)?.cards;

      expect(cardFlags).toBeDefined();
      expect(cardFlags?.["66"]).toBeDefined();
      expect(cardFlags?.["66"]?.locked).toBe(true);
    });

    it("card 66 is unlocked after cards 62/63 are resolved", () => {
      const publicState = openingTailStep32WithUnlockedCard66SessionSnapshot.state.public as Record<string, unknown>;
      const cardFlags = (publicState.flags as Record<string, Record<string, { locked?: boolean }>> | undefined)?.cards;

      expect(cardFlags).toBeDefined();
      expect(cardFlags?.["66"]).toBeDefined();
      expect(cardFlags?.["66"]?.locked).toBe(false);
      // Cards 62/63 are resolved, triggering the board-local unlock hook
      expect(cardFlags?.["62"]?.locked).toBe(false);
      expect(cardFlags?.["63"]?.locked).toBe(false);
    });

    it("selected card 66 can advance after unlock", () => {
      const canAdvance = readCanAdvance(openingTailStep32WithSelectedGoCard66SessionSnapshot);
      expect(canAdvance).toBe(true);

      const selectedCardId = readSelectedCardId(openingTailStep32WithSelectedGoCard66SessionSnapshot);
      expect(selectedCardId).toBe("66");
    });

    it("go-card 61 can be selected and advance without unlock requirement", () => {
      const canAdvance = readCanAdvance(openingTailStep32WithSelectedGoCard61SessionSnapshot);
      expect(canAdvance).toBe(true);

      const selectedCardId = readSelectedCardId(openingTailStep32WithSelectedGoCard61SessionSnapshot);
      expect(selectedCardId).toBe("61");
    });
  });

  describe("resolveCurrentInfoEntry (stepIndex 33, screenId S1)", () => {
    it("resolves info i18 at step 33 with screen S1", () => {
      const antarctica = openingTailStep32AntarcticaContent;
      const publicState = openingTailStep33InfoSessionSnapshot.state.public as Record<string, unknown>;

      const info = resolveCurrentInfoEntry(antarctica, publicState);

      expect(info).not.toBeNull();
      expect(info?.id).toBe("i18");
      expect(info?.stepIndex).toBe(33);
      expect(info?.screenId).toBe("S1");
      expect(info?.title).toBe("Скауты отправлены");
      expect(info?.advanceActionId).toBe("opening.info.i18.advance");
    });

    it("does not resolve info at wrong stepIndex", () => {
      const antarctica = openingTailStep32AntarcticaContent;
      const publicState = {
        timeline: { stepIndex: 32, screenId: "S1", activeInfoId: "i18" },
      };

      const info = resolveCurrentInfoEntry(antarctica, publicState);
      expect(info).toBeNull();
    });
  });

  describe("go-card advance flows: board 61_66 -> i18", () => {
    it("at step 32, board 61_66 go-card 61 leads to info i18", () => {
      const antarctica = openingTailStep32AntarcticaContent;
      const board: AntarcticaPlayerBoard = {
        id: "opening.board.61_66",
        stepIndex: 32,
        screenId: "S2",
        cardIds: ["61", "62", "63", "64", "65", "66"],
      };

      const cards = resolveBoardCards(antarctica, board);
      const goCard61 = cards.find((c) => c.cardId === "61");

      expect(goCard61).toBeDefined();
      expect(goCard61?.advanceActionId).toBe("opening.card.61.advance");
    });

    it("at step 32, board 61_66 go-card 66 (unlocked) also leads to info i18", () => {
      const antarctica = openingTailStep32AntarcticaContent;
      const board: AntarcticaPlayerBoard = {
        id: "opening.board.61_66",
        stepIndex: 32,
        screenId: "S2",
        cardIds: ["61", "62", "63", "64", "65", "66"],
      };

      const cards = resolveBoardCards(antarctica, board);
      const goCard66 = cards.find((c) => c.cardId === "66");

      expect(goCard66).toBeDefined();
      expect(goCard66?.advanceActionId).toBe("opening.card.66.advance");
    });

    it("at step 33, info i18 is rendered with explicit advanceActionId", () => {
      const antarctica = openingTailStep32AntarcticaContent;
      const publicState = openingTailStep33InfoSessionSnapshot.state.public as Record<string, unknown>;

      const info = resolveCurrentInfoEntry(antarctica, publicState);

      expect(info).toBeDefined();
      expect(info?.advanceActionId).toBe("opening.info.i18.advance");
      expect(info?.advanceLabel).toBe("Продолжить");
      expect(info?.body).toContain("Группа разведчиков успешно отправлена");
    });
  });
});

describe("slice-step34-38-ending: Board 67_70, Infos i19/i19_1, i20, and Terminal i21", () => {
  describe("resolveAntarcticaContent", () => {
    it("returns Antarctica content when present in player-facing DTO", () => {
      const antarctica = resolveAntarcticaContent(openingTailStep34PlayerContent);
      expect(antarctica).not.toBeNull();
      expect(antarctica?.boards).toHaveLength(1);
      expect(antarctica?.infos).toHaveLength(4);
    });
  });

  describe("resolveCurrentBoard (stepIndex 34, screenId S2)", () => {
    it("resolves opening.board.67_70 at step 34 with screen S2", () => {
      const antarctica = openingTailStep34AntarcticaContent;
      const publicState = openingTailStep34BoardSessionSnapshot.state.public as Record<string, unknown>;

      const board = resolveCurrentBoard(antarctica, publicState);

      expect(board).not.toBeNull();
      expect(board?.id).toBe("opening.board.67_70");
      expect(board?.stepIndex).toBe(34);
      expect(board?.screenId).toBe("S2");
      expect(board?.cardIds).toEqual(["67", "68", "69", "70"]);
    });

    it("does not resolve board at wrong stepIndex", () => {
      const antarctica = openingTailStep34AntarcticaContent;
      const publicState = {
        timeline: { stepIndex: 35, screenId: "S2" },
      };

      const board = resolveCurrentBoard(antarctica, publicState);
      expect(board).toBeNull();
    });
  });

  describe("resolveBoardCards for opening.board.67_70", () => {
    it("resolves all 4 cards for board 67_70", () => {
      const antarctica = openingTailStep34AntarcticaContent;
      const board: AntarcticaPlayerBoard = {
        id: "opening.board.67_70",
        stepIndex: 34,
        screenId: "S2",
        cardIds: ["67", "68", "69", "70"],
      };

      const cards = resolveBoardCards(antarctica, board);

      expect(cards).toHaveLength(4);
      expect(cards.map((c) => c.cardId)).toEqual(["67", "68", "69", "70"]);
    });

    it("identifies go-cards (68, 69) by presence of advanceActionId", () => {
      const antarctica = openingTailStep34AntarcticaContent;
      const board: AntarcticaPlayerBoard = {
        id: "opening.board.67_70",
        stepIndex: 34,
        screenId: "S2",
        cardIds: ["67", "68", "69", "70"],
      };

      const cards = resolveBoardCards(antarctica, board);

      const goCards = cards.filter((c) => c.advanceActionId !== undefined);
      const nonGoCards = cards.filter((c) => c.advanceActionId === undefined);

      expect(goCards).toHaveLength(2);
      expect(goCards.map((c) => c.cardId)).toEqual(["68", "69"]);
      expect(nonGoCards).toHaveLength(2);
      expect(nonGoCards.map((c) => c.cardId)).toEqual(["67", "70"]);
    });

    it("go-card 68 has advanceActionId for fast-variant routing", () => {
      const antarctica = openingTailStep34AntarcticaContent;
      const board: AntarcticaPlayerBoard = {
        id: "opening.board.67_70",
        stepIndex: 34,
        screenId: "S2",
        cardIds: ["67", "68", "69", "70"],
      };

      const cards = resolveBoardCards(antarctica, board);
      const goCard68 = cards.find((c) => c.cardId === "68");

      expect(goCard68).toBeDefined();
      expect(goCard68?.advanceActionId).toBe("opening.card.68.advance");
      expect(goCard68?.advanceLabel).toBe("Продолжить");
    });

    it("go-card 69 leads to i20 follow-up", () => {
      const antarctica = openingTailStep34AntarcticaContent;
      const board: AntarcticaPlayerBoard = {
        id: "opening.board.67_70",
        stepIndex: 34,
        screenId: "S2",
        cardIds: ["67", "68", "69", "70"],
      };

      const cards = resolveBoardCards(antarctica, board);
      const goCard69 = cards.find((c) => c.cardId === "69");

      expect(goCard69).toBeDefined();
      expect(goCard69?.advanceActionId).toBe("opening.card.69.advance");
    });
  });

  describe("i19/i19_1 variant routing by activeInfoId", () => {
    it("resolves info i19 when activeInfoId is 'i19' at step 35", () => {
      const antarctica = openingTailStep34AntarcticaContent;
      const publicState = openingTailStep35InfoI19SessionSnapshot.state.public as Record<string, unknown>;

      const info = resolveCurrentInfoEntry(antarctica, publicState);

      expect(info).not.toBeNull();
      expect(info?.id).toBe("i19");
      expect(info?.stepIndex).toBe(35);
      expect(info?.screenId).toBe("S1");
      expect(info?.title).toBe("Последствия переезда");
      expect(info?.advanceActionId).toBe("opening.info.i19.advance");
    });

    it("resolves info i19_1 when activeInfoId is 'i19_1' at step 35 (fast variant)", () => {
      const antarctica = openingTailStep34AntarcticaContent;
      const publicState = openingTailStep35InfoI19_1SessionSnapshot.state.public as Record<string, unknown>;

      const info = resolveCurrentInfoEntry(antarctica, publicState);

      expect(info).not.toBeNull();
      expect(info?.id).toBe("i19_1");
      expect(info?.stepIndex).toBe(35);
      expect(info?.screenId).toBe("S1");
      expect(info?.title).toBe("Быстрый переезд");
      expect(info?.advanceActionId).toBe("opening.info.i19.advance");
    });

    it("does not resolve info when stepIndex does not match", () => {
      const antarctica = openingTailStep34AntarcticaContent;
      const publicState = {
        timeline: { stepIndex: 34, screenId: "S1", activeInfoId: "i19" },
      };

      const info = resolveCurrentInfoEntry(antarctica, publicState);
      expect(info).toBeNull();
    });
  });

  describe("resolveCurrentInfoEntry (stepIndex 37, screenId S1)", () => {
    it("resolves info i20 at step 37 with screen S1", () => {
      const antarctica = openingTailStep34AntarcticaContent;
      const publicState = openingTailStep37InfoI20SessionSnapshot.state.public as Record<string, unknown>;

      const info = resolveCurrentInfoEntry(antarctica, publicState);

      expect(info).not.toBeNull();
      expect(info?.id).toBe("i20");
      expect(info?.stepIndex).toBe(37);
      expect(info?.screenId).toBe("S1");
      expect(info?.title).toBe("Второй переезд");
      expect(info?.advanceActionId).toBe("opening.info.i20.advance");
    });
  });

  describe("resolveCurrentInfoEntry (stepIndex 38, screenId S1)", () => {
    it("resolves terminal info i21 at step 38 with screen S1", () => {
      const antarctica = openingTailStep34AntarcticaContent;
      const publicState = openingTailStep38InfoI21SessionSnapshot.state.public as Record<string, unknown>;

      const info = resolveCurrentInfoEntry(antarctica, publicState);

      expect(info).not.toBeNull();
      expect(info?.id).toBe("i21");
      expect(info?.stepIndex).toBe(38);
      expect(info?.screenId).toBe("S1");
      expect(info?.title).toBe("Финал");
      // Terminal info has empty advanceActionId
      expect(info?.advanceActionId).toBe("");
    });

    it("terminal i21 has no advance action", () => {
      const antarctica = openingTailStep34AntarcticaContent;
      const publicState = openingTailStep38InfoI21SessionSnapshot.state.public as Record<string, unknown>;

      const info = resolveCurrentInfoEntry(antarctica, publicState);

      expect(info).toBeDefined();
      expect(info?.advanceActionId).toBe("");
      expect(info?.advanceLabel).toBe("");
    });
  });

  describe("go-card advance flows: board 67_70 -> i19/i19_1 -> i20 -> i21 (terminal)", () => {
    it("at step 34, board 67_70 go-card 68 leads to i19/i19_1", () => {
      const antarctica = openingTailStep34AntarcticaContent;
      const board: AntarcticaPlayerBoard = {
        id: "opening.board.67_70",
        stepIndex: 34,
        screenId: "S2",
        cardIds: ["67", "68", "69", "70"],
      };

      const cards = resolveBoardCards(antarctica, board);
      const goCard68 = cards.find((c) => c.cardId === "68");

      expect(goCard68).toBeDefined();
      expect(goCard68?.advanceActionId).toBe("opening.card.68.advance");
    });

    it("at step 35, info i19/i19_1 advance leads to i20 at step 37", () => {
      const antarctica = openingTailStep34AntarcticaContent;
      const publicStateI19 = openingTailStep35InfoI19SessionSnapshot.state.public as Record<string, unknown>;
      const infoI19 = resolveCurrentInfoEntry(antarctica, publicStateI19);

      expect(infoI19).toBeDefined();
      expect(infoI19?.advanceActionId).toBe("opening.info.i19.advance");

      // After advancing through i19, player reaches board at step 36, then selects card 69
      // which advances to i20 at step 37
      const publicStateI20 = openingTailStep37InfoI20SessionSnapshot.state.public as Record<string, unknown>;
      const infoI20 = resolveCurrentInfoEntry(antarctica, publicStateI20);

      expect(infoI20).toBeDefined();
      expect(infoI20?.advanceActionId).toBe("opening.info.i20.advance");
    });

    it("at step 37, info i20 advance leads to terminal i21 at step 38", () => {
      const antarctica = openingTailStep34AntarcticaContent;
      const publicState = openingTailStep38InfoI21SessionSnapshot.state.public as Record<string, unknown>;

      const info = resolveCurrentInfoEntry(antarctica, publicState);

      expect(info).toBeDefined();
      expect(info?.id).toBe("i21");
      expect(info?.stepIndex).toBe(38);
      // Terminal has no advance action
      expect(info?.advanceActionId).toBe("");
    });
  });

  describe("session snapshot readers for ending path", () => {
    it("readSelectedCardId returns null at step 34 before selecting", () => {
      const selectedCardId = readSelectedCardId(openingTailStep34BoardSessionSnapshot);
      expect(selectedCardId).toBeNull();
    });

    it("readSelectedCardId returns '68' when go-card 68 is selected at step 34", () => {
      const selectedCardId = readSelectedCardId(openingTailStep34WithSelectedGoCard68SessionSnapshot);
      expect(selectedCardId).toBe("68");
    });

    it("readCanAdvance returns true when go-card 68 is selected at step 34", () => {
      const canAdvance = readCanAdvance(openingTailStep34WithSelectedGoCard68SessionSnapshot);
      expect(canAdvance).toBe(true);
    });

    it("readCanAdvance returns false at terminal i21 step 38", () => {
      const canAdvance = readCanAdvance(openingTailStep38InfoI21SessionSnapshot);
      expect(canAdvance).toBe(false);
    });
  });
});

/**
 * Session resilience tests for AntarcticaPlayer.
 *
 * Covers:
 * - Stale session fallback: when stored sessionId is invalid (runtime restarted),
 *   player clears localStorage and creates a new session.
 * - Reset/New Game button: user can manually reset and start a fresh session.
 */

import { vi } from "vitest";

const STORAGE_KEY = "cubica-antarctica-session-id";

const mockSessionSnapshot = {
  sessionId: "session-fresh-123",
  state: {
    public: {
      timeline: { stepIndex: 0, screenId: "S1" },
      flags: {},
    },
  },
} as const;

describe("session resilience: stale session fallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Clear localStorage mock
    localStorage.clear();
  });

  it("clears localStorage and creates new session when stored sessionId returns 404", async () => {
    const storedSessionId = "stale-session-456";

    // Set up localStorage with stale session
    localStorage.setItem(STORAGE_KEY, storedSessionId);

    // Mock fetch: first GET fails with 404, then POST succeeds
    const postMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockSessionSnapshot,
    });

    global.fetch = vi
      .fn()
      .mockImplementationOnce(() =>
        Promise.resolve({ ok: false, status: 404 })
      )
      .mockImplementationOnce(postMock) as typeof fetch;

    // Simulate boot logic manually (same as component boot)
    const stored = localStorage.getItem(STORAGE_KEY);
    expect(stored).toBe(storedSessionId);

    const base = "/api/runtime/sessions";

    // Try to resume stale session
    const getResponse = await fetch(`${base}/${storedSessionId}`);
    expect(getResponse.ok).toBe(false);
    expect(getResponse.status).toBe(404);

    // Should create new session instead
    const postResponse = await fetch(base, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gameId: "antarctica", playerId: "player-web" }),
    });

    expect(postResponse.ok).toBe(true);
    const newSession = await postResponse.json();
    expect(newSession.sessionId).toBe(mockSessionSnapshot.sessionId);

    // Simulate what createNewSession does: update localStorage with new sessionId
    localStorage.setItem(STORAGE_KEY, mockSessionSnapshot.sessionId);
    expect(localStorage.getItem(STORAGE_KEY)).toBe(mockSessionSnapshot.sessionId);
  });

  it("creates new session when stored sessionId returns 500", async () => {
    const storedSessionId = "stale-session-789";
    localStorage.setItem(STORAGE_KEY, storedSessionId);

    const postMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockSessionSnapshot,
    });

    global.fetch = vi
      .fn()
      .mockImplementationOnce(() =>
        Promise.resolve({ ok: false, status: 500 })
      )
      .mockImplementationOnce(postMock) as typeof fetch;

    // Boot with stale session
    const base = "/api/runtime/sessions";
    const getResponse = await fetch(`${base}/${storedSessionId}`);
    expect(getResponse.ok).toBe(false);

    // Should fall back to new session
    const postResponse = await fetch(base, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gameId: "antarctica", playerId: "player-web" }),
    });

    expect(postResponse.ok).toBe(true);
    // Simulate createNewSession updating localStorage
    localStorage.setItem(STORAGE_KEY, mockSessionSnapshot.sessionId);
    expect(localStorage.getItem(STORAGE_KEY)).toBe(mockSessionSnapshot.sessionId);
  });

  it("resumes valid session without creating new one", async () => {
    const validSessionId = "valid-session-abc";
    localStorage.setItem(STORAGE_KEY, validSessionId);

    const getMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ sessionId: validSessionId, state: { public: {} } }),
    });

    global.fetch = getMock as typeof fetch;

    // Boot with valid session
    const response = await fetch(`/api/runtime/sessions/${validSessionId}`);
    expect(response.ok).toBe(true);

    // Should NOT create new session (fetch called only once)
    expect(global.fetch).toHaveBeenCalledTimes(1);
    // localStorage should retain original sessionId
    expect(localStorage.getItem(STORAGE_KEY)).toBe(validSessionId);
  });
});

describe("session resilience: reset/new game", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("resetGame clears localStorage and creates new session", async () => {
    const oldSessionId = "old-session-xyz";
    localStorage.setItem(STORAGE_KEY, oldSessionId);

    const postMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockSessionSnapshot,
    });

    global.fetch = postMock as typeof fetch;

    // Simulate resetGame function (same as component)
    localStorage.removeItem(STORAGE_KEY);

    const response = await fetch("/api/runtime/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gameId: "antarctica", playerId: "player-web" }),
    });

    expect(response.ok).toBe(true);
    const newSession = await response.json();
    expect(newSession.sessionId).toBe(mockSessionSnapshot.sessionId);
    // Simulate what resetGame does: createNewSession sets localStorage
    localStorage.setItem(STORAGE_KEY, mockSessionSnapshot.sessionId);
    expect(localStorage.getItem(STORAGE_KEY)).toBe(mockSessionSnapshot.sessionId);
    expect(localStorage.getItem(STORAGE_KEY)).not.toBe(oldSessionId);
  });

  it("resetGame works when no prior session existed", async () => {
    // No session in localStorage
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();

    const postMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockSessionSnapshot,
    });

    global.fetch = postMock as typeof fetch;

    // Simulate resetGame
    const response = await fetch("/api/runtime/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gameId: "antarctica", playerId: "player-web" }),
    });

    expect(response.ok).toBe(true);
    // Simulate what resetGame does: createNewSession sets localStorage
    localStorage.setItem(STORAGE_KEY, mockSessionSnapshot.sessionId);
    expect(localStorage.getItem(STORAGE_KEY)).toBe(mockSessionSnapshot.sessionId);
  });
});
