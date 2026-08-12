/**
 * Phaser renderer for the Estate Race public field.
 *
 * The scene paints the authoritative snapshot and forwards only actions that
 * Runtime API already exposed. Balance, rent, movement and ownership rules are
 * intentionally absent from this file.
 */

import type {
  InteractiveBoardSceneHandle,
  PhaserSceneContext,
  PhaserSceneFactory
} from "@cubica/player-web/plugin-api";

import { provideEstateRaceAccessibleBoardActions } from "./accessible-actions.ts";
import {
  projectEstateRaceSession,
  traceEstateTokenPath,
  type EstateActionView,
  type EstateBoardProjection,
  type EstateCellView
} from "./board-state.ts";

const DESIGN_WIDTH = 1400;
const DESIGN_HEIGHT = 1000;
const PLAYER_COLORS = [0x245f52, 0xb56f3c, 0x735b87, 0x3c6f91, 0x9b7332, 0x934c54];

const phaseLabel: Readonly<Record<string, string>> = {
  setup: "определение порядка",
  roll: "бросок",
  acquire: "покупка",
  rent: "рента",
  tax: "налог",
  resolve: "эффект клетки",
  blocked: "следующий срез",
  finish: "завершение",
  auction: "аукцион",
  buildingWindow: "окно заявок",
  buildingAuction: "аукцион строений",
  jail: "тюрьма",
  terminal: "завершено"
};

const errorText = (error: unknown) =>
  error instanceof Error ? error.message : "Действие отклонено сервером";

const tokenPosition = (cell: EstateCellView, playerIndex: number) => ({
  x: cell.x - 32 + (playerIndex % 3) * 32,
  y: cell.y + cell.height / 2 - 18 - Math.floor(playerIndex / 3) * 28
});

// These commands require a DOM form to collect declared parameters. The
// canvas must not guess a cell or unit kind and must never submit an empty
// request that the server would reject.
const canvasCanDispatch = (action: EstateActionView): boolean =>
  action.actionId !== "property.build.request"
  && action.actionId !== "property.auction.bid"
  && action.actionId !== "property.build.auction.bid";

/** Build a scene solely from platform-injected Phaser. */
export const createEstateRaceScene: PhaserSceneFactory = (
  context: PhaserSceneContext
): InteractiveBoardSceneHandle => {
  const Phaser = context.Phaser;
  let currentSession = context.session;
  let previousProjection: EstateBoardProjection | null = null;
  let lastError: string | null = null;

  class EstateRaceScene extends Phaser.Scene {
    private projectionReady = false;

    constructor() {
      super({ key: `estate-race:${context.sceneId}` });
    }

    create() {
      this.projectionReady = true;
      this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
        this.projectionReady = false;
      });
      this.cameras.main.setBackgroundColor("#13211f");
      this.renderProjection(true);
    }

    renderProjection(initial = false) {
      if (!this.projectionReady) return;
      const projection = projectEstateRaceSession(currentSession);
      this.children.removeAll(true);
      const graphics = this.add.graphics();

      graphics.fillStyle(0x13211f, 1);
      graphics.fillRect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT);
      graphics.lineStyle(2, 0x42635d, 0.55);
      for (let x = 24; x < DESIGN_WIDTH; x += 36) graphics.lineBetween(x, 0, x, DESIGN_HEIGHT);
      for (let y = 24; y < DESIGN_HEIGHT; y += 36) graphics.lineBetween(0, y, DESIGN_WIDTH, y);

      this.drawCentre(projection);
      for (const cell of projection.cells) this.drawCell(graphics, cell, projection, initial);
      this.drawPlayers(projection, initial);
      this.drawStatus(projection);

      if (lastError) {
        this.add.text(DESIGN_WIDTH / 2, DESIGN_HEIGHT - 22, lastError, {
          color: "#fff7e8",
          backgroundColor: "#8d3d36",
          padding: { x: 16, y: 9 },
          fontFamily: "Georgia, serif",
          fontSize: "20px"
        }).setOrigin(0.5, 1);
      }

      previousProjection = projection;
    }

    private drawCentre(projection: EstateBoardProjection) {
      const plaque = this.add.rectangle(680, 475, 690, 380, 0xe8dfca, 1)
        .setStrokeStyle(5, 0xb56f3c, 0.75);
      if (!previousProjection) {
        plaque.setAlpha(0);
        this.tweens.add({ targets: plaque, alpha: 1, duration: 420, ease: "Cubic.Out" });
      }

      this.add.text(680, 370, "ESTATE RACE", {
        color: "#173a34",
        fontFamily: "Georgia, serif",
        fontSize: "54px",
        fontStyle: "bold",
        letterSpacing: 5
      }).setOrigin(0.5);
      this.add.text(680, 425, `Ход ${projection.turnNumber} · ${phaseLabel[projection.phase] ?? projection.phase}`, {
        color: "#495c55",
        fontFamily: "Arial, sans-serif",
        fontSize: "22px"
      }).setOrigin(0.5);

      this.add.text(680, 455,
        `Банк строений · дома ${projection.bankBuildings.housesAvailable}/32 · отели ${projection.bankBuildings.hotelsAvailable}/12`, {
          color: "#495c55",
          fontFamily: "Arial, sans-serif",
          fontSize: "17px"
        }).setOrigin(0.5);

      if (projection.outcome.status === "terminal") {
        this.drawOutcomeSummary(projection);
      } else if (projection.phase === "terminal") {
        this.add.text(680, 505, "Итог игры недоступен: сервер не подтвердил корректный результат.", {
          color: "#8d3d36",
          align: "center",
          wordWrap: { width: 600 },
          fontFamily: "Arial, sans-serif",
          fontSize: "20px"
        }).setOrigin(0.5);
      } else if (projection.phase === "buildingWindow") {
        this.drawBuildingWindowSummary(projection);
      } else if (projection.phase === "buildingAuction") {
        this.drawBuildingAuctionSummary(projection);
      } else if (projection.phase === "auction") {
        this.drawAuctionSummary(projection);
      } else if (projection.lastRoll) {
        const dice = projection.lastRoll.values.map((value) => `[ ${value} ]`).join("   ");
        this.add.text(680, 485, `${dice}\nсумма ${projection.lastRoll.total}`, {
          color: "#173a34",
          align: "center",
          fontFamily: "Georgia, serif",
          fontSize: "30px",
          lineSpacing: 8
        }).setOrigin(0.5);
      } else {
        this.add.text(680, 485, "Кости ждут первого броска", {
          color: "#66746d",
          fontFamily: "Georgia, serif",
          fontSize: "24px"
        }).setOrigin(0.5);
      }

      if (projection.phase === "blocked") {
        this.add.text(680, 535, "Эта клетка ещё не активирована в текущем срезе игры. Действий нет.", {
          color: "#8d3d36",
          align: "center",
          wordWrap: { width: 540 },
          fontFamily: "Arial, sans-serif",
          fontSize: "20px"
        }).setOrigin(0.5);
      }

      if (projection.outcome.status !== "terminal"
        && projection.phase !== "terminal"
        && projection.phase !== "blocked"
        && projection.phase !== "auction") {
        this.drawCardAndJailSummary(projection);
      }
      if (projection.outcome.status !== "terminal") this.drawS5Summary(projection);

      // A bid requires the numeric DOM form. Never dispatch an empty bid from
      // the canvas; the server remains the authority for the submitted amount.
      const action = projection.availableActions.find((item) =>
        !item.disabled && canvasCanDispatch(item)
      );
      if (action) this.drawPrimaryAction(action);
    }

    private drawAuctionSummary(projection: EstateBoardProjection) {
      const auction = projection.auction;
      const auctionCell = auction.cellId === null
        ? null
        : projection.cells.find((cell) => cell.id === auction.cellId);
      const minimumNextBid = auction.minimumNextBid === null ? "—" : auction.minimumNextBid;
      const lines = [
        `Аукцион · ${auctionCell?.shortLabel ?? auction.cellId ?? "объект не объявлен"}`,
        `Текущая ставка: ${auction.currentBid}`,
        `Минимальная следующая ставка: ${minimumNextBid}`,
        `Минимальный шаг: ${auction.minimumIncrement}`,
        `Лидер: ${auction.leaderPlayerId ?? "нет"}`,
        `Ход вернётся: ${auction.resumePlayerId ?? "не объявлено"}`
      ];
      this.add.text(680, 485, lines.join("\n"), {
        color: "#173a34",
        align: "center",
        fontFamily: "Arial, sans-serif",
        fontSize: "21px",
        lineSpacing: 7,
        wordWrap: { width: 600 }
      }).setOrigin(0.5);
    }

    private drawOutcomeSummary(projection: EstateBoardProjection) {
      const winnerId = projection.outcome.winnerPlayerId;
      const winner = winnerId === null
        ? null
        : projection.players.find((player) => player.id === winnerId);
      const winnerLabel = winner?.label ?? winnerId;
      const result = winnerLabel === null
        ? "Победитель не объявлен"
        : `Победитель: ${winnerLabel}`;
      this.add.text(680, 505, ["Игра завершена", result].join("\n"), {
        color: "#173a34",
        align: "center",
        fontFamily: "Georgia, serif",
        fontSize: "30px",
        fontStyle: "bold",
        lineSpacing: 12,
        wordWrap: { width: 600 }
      }).setOrigin(0.5);
      this.add.text(680, 590, projection.outcome.reason === "last-active-player"
        ? "Последний активный участник"
        : "Результат подтверждён сервером", {
          color: "#495c55",
          align: "center",
          fontFamily: "Arial, sans-serif",
          fontSize: "18px",
          wordWrap: { width: 560 }
        }).setOrigin(0.5);
    }

    private drawBuildingWindowSummary(projection: EstateBoardProjection) {
      const window = projection.buildingWindow;
      this.add.text(680, 505, [
        `Окно заявок · ${window.unitKind ?? "тип не объявлен"}`,
        `Продолжит ход: ${window.resumePlayerId ?? "не объявлено"}`
      ].join("\n"), {
        color: "#173a34",
        align: "center",
        fontFamily: "Arial, sans-serif",
        fontSize: "21px",
        lineSpacing: 7
      }).setOrigin(0.5);
    }

    private drawBuildingAuctionSummary(projection: EstateBoardProjection) {
      const auction = projection.buildingAuction;
      this.add.text(680, 505, [
        "Аукцион строений",
        `Текущая ставка: ${auction.currentBid}`,
        `Минимальный шаг: ${auction.minimumIncrement}`,
        `Лидер: ${auction.leaderPlayerId ?? "нет"}`
      ].join("\n"), {
        color: "#173a34",
        align: "center",
        fontFamily: "Arial, sans-serif",
        fontSize: "21px",
        lineSpacing: 7
      }).setOrigin(0.5);
    }

    private drawS5Summary(projection: EstateBoardProjection) {
      const lines: string[] = [];
      if (projection.trade.status !== "idle") {
        const trade = projection.trade;
        lines.push(`Сделка: ${trade.status} · ${trade.proposerPlayerId ?? "—"} → ${trade.targetPlayerId ?? "—"}`);
        lines.push(`Деньги: ${trade.offeredCash} / ${trade.requestedCash}`);
      }
      if (projection.obligation.status !== "idle") {
        const debt = projection.obligation;
        lines.push(`Обязательство: ${debt.status} · должник ${debt.debtorPlayerId ?? "—"} · ${debt.amount}`);
        lines.push(`Причина: ${debt.reason ?? "—"} · получатель ${debt.creditorPlayerId ?? debt.creditorKind ?? "—"}`);
      }
      if (projection.liquidation.status !== "idle") {
        const liquidation = projection.liquidation;
        lines.push(`Ликвидация: ${liquidation.status}`);
        if (liquidation.pendingCellId !== null) lines.push(`Ожидает клетку: ${liquidation.pendingCellId}`);
      }
      if (lines.length === 0) return;
      this.add.text(680, 695, lines.join("\n"), {
        color: "#8d3d36",
        align: "center",
        fontFamily: "Arial, sans-serif",
        fontSize: "16px",
        lineSpacing: 4,
        wordWrap: { width: 600 }
      }).setOrigin(0.5);
    }

    private drawCardAndJailSummary(projection: EstateBoardProjection) {
      const activePlayer = projection.players.find((player) => player.id === projection.activePlayerId);
      const heldPlayer = projection.players.find((player) =>
        player.heldExitCardId !== null || player.heldExitCardId2 !== null
      );
      const heldCards = heldPlayer === undefined
        ? []
        : [heldPlayer.heldExitCardId, heldPlayer.heldExitCardId2]
            .filter((cardId): cardId is string => cardId !== null);
      const lines = [
        projection.lastCardId === null ? null : `Последняя открытая карта: ${projection.lastCardId}`,
        activePlayer?.inJail
          ? `Попытки выхода: ${activePlayer.jailAttempts}/3`
          : null,
        heldPlayer === undefined || heldCards.length === 0
          ? null
          : `${heldPlayer.label}: карты выхода ${heldCards.join(", ")}`
      ].filter((line): line is string => line !== null);
      if (lines.length === 0) return;
      this.add.text(680, 550, lines.join("\n"), {
        color: "#495c55",
        align: "center",
        fontFamily: "Arial, sans-serif",
        fontSize: "17px",
        lineSpacing: 5,
        wordWrap: { width: 580 }
      }).setOrigin(0.5);
    }

    private drawPrimaryAction(action: EstateActionView) {
      const button = this.add.rectangle(680, 620, 360, 68, 0x245f52, 1)
        .setStrokeStyle(2, 0xf4e8cf, 0.65)
        .setInteractive({ useHandCursor: true });
      this.add.text(680, 620, action.label, {
        color: "#fff9e9",
        fontFamily: "Arial, sans-serif",
        fontSize: "23px",
        fontStyle: "bold"
      }).setOrigin(0.5);
      button.on("pointerover", () => button.setFillStyle(0x327565, 1));
      button.on("pointerout", () => button.setFillStyle(0x245f52, 1));
      button.on("pointerdown", () => this.dispatchAction(action));
    }

    private drawCell(
      graphics: InstanceType<typeof Phaser.GameObjects.Graphics>,
      cell: EstateCellView,
      projection: EstateBoardProjection,
      initial: boolean
    ) {
      const estate = cell.kind === "estate";
      const fill = estate
        ? 0xf2e5ca
        : cell.kind === "start"
          ? 0xb9d2c2
          : cell.kind === "tax" || cell.kind === "go-to-jail"
            ? 0xd9b5a7
            : cell.kind === "event" || cell.kind === "fund"
              ? 0xc8d4df
              : 0xded7c5;
      graphics.fillStyle(fill, 1);
      const auctionCell = projection.phase === "auction" && projection.auction.cellId === cell.id;
      graphics.lineStyle(
        auctionCell ? 6 : estate ? 4 : 2,
        auctionCell ? 0x245f52 : estate ? 0xb56f3c : 0x6f8178,
        0.95
      );
      graphics.fillRoundedRect(cell.x - cell.width / 2, cell.y - cell.height / 2, cell.width, cell.height, 12);
      graphics.strokeRoundedRect(cell.x - cell.width / 2, cell.y - cell.height / 2, cell.width, cell.height, 12);

      this.add.text(cell.x, cell.y - 30, cell.shortLabel, {
        color: "#183a34",
        align: "center",
        fontFamily: "Georgia, serif",
        fontSize: estate ? "13px" : "12px",
        fontStyle: estate ? "bold" : "normal",
        wordWrap: { width: cell.width - 24 }
      }).setOrigin(0.5);

      const detail = estate || cell.kind === "transit" || cell.kind === "utility"
        ? `${cell.price ?? "—"} · рента ${cell.rent ?? "—"}`
        : cell.kind === "tax" ? `сбор ${cell.taxAmount ?? "—"}` : `клетка ${cell.index}`;
      this.add.text(cell.x, cell.y + 20, detail, {
        color: "#65716c",
        fontFamily: "Arial, sans-serif",
        fontSize: "10px"
      }).setOrigin(0.5);

      if (estate && cell.improvementTier > 0) {
        const marker = cell.improvementTier === 5
          ? "★ ОТЕЛЬ"
          : `${"■".repeat(cell.improvementTier)} ДОМА`;
        this.add.text(cell.x, cell.y + 42, marker, {
          color: cell.improvementTier === 5 ? "#8d3d36" : "#245f52",
          fontFamily: "Arial, sans-serif",
          fontSize: "11px",
          fontStyle: "bold"
        }).setOrigin(0.5);
      }
      if (cell.mortgaged) {
        this.add.text(cell.x, cell.y - cell.height / 2 + 12, "ЗАЛОЖЕНО", {
          color: "#8d3d36",
          backgroundColor: "#fff1e4",
          fontFamily: "Arial, sans-serif",
          fontSize: "10px",
          fontStyle: "bold",
          padding: { x: 5, y: 3 }
        }).setOrigin(0.5);
      }
      if (cell.tradeSide !== null) {
        this.add.text(cell.x, cell.y + cell.height / 2 - 30, `СДЕЛКА: ${cell.tradeSide}`, {
          color: "#735b87",
          fontFamily: "Arial, sans-serif",
          fontSize: "9px",
          fontStyle: "bold"
        }).setOrigin(0.5);
      }
      if (cell.liquidationPending) {
        this.add.text(cell.x, cell.y + cell.height / 2 - 30, "ЛИКВИДАЦИЯ", {
          color: "#8d3d36",
          fontFamily: "Arial, sans-serif",
          fontSize: "9px",
          fontStyle: "bold"
        }).setOrigin(0.5);
      }

      if (cell.ownerPlayerId) {
        const ownerIndex = projection.players.findIndex((player) => player.id === cell.ownerPlayerId);
        const ribbon = this.add.rectangle(cell.x, cell.y + cell.height / 2 - 12, cell.width - 22, 18,
          PLAYER_COLORS[Math.max(0, ownerIndex)] ?? PLAYER_COLORS[0], 1);
        const previousOwner = previousProjection?.cells.find((item) => item.id === cell.id)?.ownerPlayerId;
        if (!initial && previousOwner !== cell.ownerPlayerId) {
          ribbon.setAlpha(0);
          this.tweens.add({ targets: ribbon, alpha: 1, duration: 360, ease: "Sine.Out" });
        }
      }

      const cellAction = projection.availableActions.find((action) => action.params?.cellId === cell.id);
      if (cellAction && !cellAction.disabled && canvasCanDispatch(cellAction)) {
        const hit = this.add.zone(cell.x, cell.y, cell.width, cell.height)
          .setInteractive({ useHandCursor: true });
        hit.on("pointerdown", () => this.dispatchAction(cellAction));
      }
    }

    private drawPlayers(projection: EstateBoardProjection, initial: boolean) {
      projection.players.forEach((player, index) => {
        const cell = projection.cells.find((item) => item.index === player.position);
        if (!cell) return;
        const currentTokenPosition = tokenPosition(cell, index);
        const token = this.add.circle(
          currentTokenPosition.x,
          currentTokenPosition.y,
          player.active ? 12 : 10,
          PLAYER_COLORS[index] ?? PLAYER_COLORS[0],
          1
        ).setStrokeStyle(4, 0xfff7e4, 1);

        const previousPlayer = previousProjection?.players.find((item) => item.id === player.id);
        const previousCell = previousProjection?.cells.find((item) => item.index === previousPlayer?.position);
        if (!initial && previousPlayer && previousCell && previousPlayer.position !== player.position) {
          const previousTokenPosition = tokenPosition(previousCell, index);
          token.setPosition(previousTokenPosition.x, previousTokenPosition.y);
          const track = traceEstateTokenPath(
            projection.cells,
            previousPlayer.position,
            player.position
          );
          this.tweens.add({
            targets: token,
            // Tweening through every crossed cell keeps the token on the
            // cyclic track instead of cutting diagonally across the board.
            x: track.map((item) => tokenPosition(item, index).x),
            y: track.map((item) => tokenPosition(item, index).y),
            duration: Math.max(360, track.length * 130),
            interpolation: "linear",
            ease: "Cubic.InOut"
          });
        }
      });
    }

    private drawStatus(projection: EstateBoardProjection) {
      projection.players.forEach((player, index) => {
        const spacing = 1100 / Math.max(1, projection.players.length - 1);
        const x = projection.players.length === 1 ? 700 : 150 + index * spacing;
        const jailStatus = player.inJail ? ` · в тюрьме (${player.jailAttempts}/3)` : "";
        const heldStatus = player.heldExitCardId === null ? "" : " · карта выхода";
        this.add.text(x, 975, `${player.label}${player.active ? " · ходит" : ""}${jailStatus}${heldStatus}   ${player.cash} монет`, {
          color: player.active ? "#fff4d8" : "#b9c7c2",
          fontFamily: "Arial, sans-serif",
          fontSize: player.active ? "16px" : "14px",
          fontStyle: player.active ? "bold" : "normal"
        }).setOrigin(0.5, 1);
      });
    }

    private dispatchAction(action: EstateActionView) {
      if (action.disabled) return;
      void context.dispatchAction(action.actionId, { ...(action.params ?? {}) })
        .then(() => { lastError = null; })
        .catch((error: unknown) => {
          // Runtime refusal must not mutate the board; only transient feedback
          // is rendered over the last confirmed snapshot.
          lastError = errorText(error);
          this.renderProjection();
        });
    }
  }

  const scene = new EstateRaceScene();
  return {
    scene,
    updateSession(session) {
      currentSession = session;
      lastError = null;
      scene.renderProjection();
    },
    destroy() {
      lastError = null;
      previousProjection = null;
      if (scene.sys?.isActive()) scene.children.removeAll(true);
    },
    getAccessibleActions: provideEstateRaceAccessibleBoardActions
  };
};
