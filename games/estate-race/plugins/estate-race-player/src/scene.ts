/**
 * Phaser renderer for the Estate Race public field.
 *
 * The scene paints the authoritative snapshot and forwards only actions that
 * Runtime API already exposed. Balance, rent, movement and ownership rules are
 * intentionally absent from this file.
 */

import type {
  AccessibleBoardAction,
  InteractiveBoardSceneHandle,
  PhaserSceneContext,
  PhaserSceneFactory
} from "@cubica/player-web/plugin-api";

import {
  projectEstateRaceSession,
  type EstateActionView,
  type EstateBoardProjection,
  type EstateCellView
} from "./board-state";

const DESIGN_WIDTH = 1400;
const DESIGN_HEIGHT = 1000;
const PLAYER_COLORS = [0x245f52, 0xb56f3c];

const phaseLabel: Readonly<Record<string, string>> = {
  roll: "бросок",
  acquire: "покупка",
  rent: "рента",
  finish: "завершение"
};

const errorText = (error: unknown) =>
  error instanceof Error ? error.message : "Действие отклонено сервером";

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

      if (projection.lastRoll) {
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

      const action = projection.availableActions.find((item) => !item.disabled);
      if (action) this.drawPrimaryAction(action);
    }

    private drawPrimaryAction(action: EstateActionView) {
      const button = this.add.rectangle(680, 595, 360, 68, 0x245f52, 1)
        .setStrokeStyle(2, 0xf4e8cf, 0.65)
        .setInteractive({ useHandCursor: true });
      this.add.text(680, 595, action.label, {
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
      const fill = estate ? 0xf2e5ca : cell.kind === "start" ? 0xb9d2c2 : 0xded7c5;
      graphics.fillStyle(fill, 1);
      graphics.lineStyle(estate ? 4 : 2, estate ? 0xb56f3c : 0x6f8178, 0.95);
      graphics.fillRoundedRect(cell.x - cell.width / 2, cell.y - cell.height / 2, cell.width, cell.height, 12);
      graphics.strokeRoundedRect(cell.x - cell.width / 2, cell.y - cell.height / 2, cell.width, cell.height, 12);

      this.add.text(cell.x, cell.y - 30, cell.shortLabel, {
        color: "#183a34",
        align: "center",
        fontFamily: "Georgia, serif",
        fontSize: estate ? "22px" : "19px",
        fontStyle: estate ? "bold" : "normal",
        wordWrap: { width: cell.width - 24 }
      }).setOrigin(0.5);

      const detail = estate ? `${cell.price} · рента ${cell.rent}` : `клетка ${cell.index}`;
      this.add.text(cell.x, cell.y + 20, detail, {
        color: "#65716c",
        fontFamily: "Arial, sans-serif",
        fontSize: "15px"
      }).setOrigin(0.5);

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
      if (cellAction && !cellAction.disabled) {
        const hit = this.add.zone(cell.x, cell.y, cell.width, cell.height)
          .setInteractive({ useHandCursor: true });
        hit.on("pointerdown", () => this.dispatchAction(cellAction));
      }
    }

    private drawPlayers(projection: EstateBoardProjection, initial: boolean) {
      projection.players.forEach((player, index) => {
        const cell = projection.cells.find((item) => item.index === player.position);
        if (!cell) return;
        const token = this.add.circle(
          cell.x - 30 + index * 60,
          cell.y + cell.height / 2 - 32,
          player.active ? 17 : 14,
          PLAYER_COLORS[index] ?? PLAYER_COLORS[0],
          1
        ).setStrokeStyle(4, 0xfff7e4, 1);

        const previousPlayer = previousProjection?.players.find((item) => item.id === player.id);
        const previousCell = previousProjection?.cells.find((item) => item.index === previousPlayer?.position);
        if (!initial && previousPlayer && previousCell && previousPlayer.position !== player.position) {
          token.setPosition(previousCell.x - 30 + index * 60, previousCell.y + previousCell.height / 2 - 32);
          const stepCount = (player.position - previousPlayer.position + projection.cells.length) % projection.cells.length;
          const track = Array.from({ length: stepCount }, (_, step) =>
            projection.cells.find((item) =>
              item.index === (previousPlayer.position + step + 1) % projection.cells.length
            )
          ).filter((item): item is EstateCellView => item !== undefined);
          this.tweens.add({
            targets: token,
            // Tweening through every crossed cell keeps the token on the
            // cyclic track instead of cutting diagonally across the board.
            x: track.map((item) => item.x - 30 + index * 60),
            y: track.map((item) => item.y + item.height / 2 - 32),
            duration: Math.max(360, track.length * 130),
            interpolation: "linear",
            ease: "Cubic.InOut"
          });
        }
      });
    }

    private drawStatus(projection: EstateBoardProjection) {
      projection.players.forEach((player, index) => {
        const x = index === 0 ? 420 : 940;
        this.add.text(x, 975, `${player.label}${player.active ? " · ходит" : ""}   ${player.cash} монет`, {
          color: player.active ? "#fff4d8" : "#b9c7c2",
          fontFamily: "Arial, sans-serif",
          fontSize: player.active ? "22px" : "19px",
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
    getAccessibleActions(session): readonly AccessibleBoardAction[] {
      return projectEstateRaceSession(session).availableActions.map((action) => ({ ...action }));
    }
  };
};
