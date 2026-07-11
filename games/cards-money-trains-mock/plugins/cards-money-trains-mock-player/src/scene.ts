/**
 * Phaser scene for the public Cards Money Trains board projection.
 *
 * The scene is intentionally a renderer and input adapter. It derives no
 * legal moves, costs, region crossings, balances, or topology. Highlights and
 * action payloads must already be present in the runtime-owned public snapshot.
 */

import type {
  AccessibleBoardAction,
  InteractiveBoardSceneHandle,
  PhaserSceneContext,
  PhaserSceneFactory
} from "@cubica/player-web/plugin-api";

import {
  projectBoardSession,
  type BoardEdgeView,
  type BoardHighlightView,
  type BoardNodeView,
  type BoardProjection,
  type CanonicalPoint
} from "./board-state";

const DESIGN_WIDTH = 1400;
const DESIGN_HEIGHT = 1000;
const MAP_LEFT = 24;
const MAP_TOP = 104;
const MAP_WIDTH = 1000;
const MAP_HEIGHT = 714;
const SIDEBAR_LEFT = 1048;
const SIDEBAR_WIDTH = 328;

const edgeColor = (edge: BoardEdgeView) => {
  if (edge.visualState === "blocked") return 0xc94c4c;
  if (edge.visualState === "building") return 0xe0a33a;
  return 0x374b59;
};

const nodeColor = (node: BoardNodeView) =>
  node.objectType === "transport.waypoint" ? 0xe5a338 : 0xf4ead5;

const errorText = (error: unknown) => error instanceof Error ? error.message : "Действие отклонено runtime";

const phaseLabels: Readonly<Record<string, string>> = {
  setup: "Подготовка",
  news: "Новость",
  maintenance: "Обслуживание",
  market: "Рынок техники",
  cargo: "Выбор грузов",
  operations: "Операции",
  movement: "Перевозки",
  construction: "Строительство",
  reporting: "Подведение итогов",
  debrief: "Разбор игры",
  finished: "Игра завершена",
  unknown: "Этап не указан"
};

const phaseLabel = (phase: string) => phaseLabels[phase] ?? phase;

const constructionModeLabel = (mode: string | null) => {
  if (mode === "road") return "строится дорога";
  if (mode === "waypoint") return "ставится полустанок";
  return "объект не выбран";
};

const truncate = (value: string, length: number) =>
  value.length <= length ? value : `${value.slice(0, length - 1)}…`;

/** Build a scene instance exclusively from platform-injected Phaser. */
export const createCardsMoneyTrainsScene: PhaserSceneFactory = (
  context: PhaserSceneContext
): InteractiveBoardSceneHandle => {
  const Phaser = context.Phaser;
  let currentSession = context.session;
  let lastError: string | null = null;
  let disposed = false;

  class CardsMoneyTrainsScene extends Phaser.Scene {
    /**
     * Phaser does not mark a scene active until its `create` callback returns.
     * A dedicated readiness flag lets that callback paint its first frame while
     * still preventing snapshot updates after shutdown from touching managers
     * that Phaser has already released.
     */
    private projectionReady = false;

    constructor() {
      super({ key: `cards-money-trains:${context.sceneId}` });
    }

    preload() {
      // Resolve only a declared ADR-063 asset id. The scene never reads a file
      // path or accepts a mutable URL from game state.
      this.load.image("cards-money-trains-board", context.assets.url("board-guinea-optimized"));
    }

    create() {
      if (disposed) return;
      this.projectionReady = true;
      this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
        this.projectionReady = false;
      });
      this.cameras.main.setBackgroundColor("#e8decb");
      // One restrained entrance confirms that the working surface is ready.
      // Phaser owns the tween and removes it with the scene lifecycle.
      this.cameras.main.fadeIn(180, 232, 222, 203);
      this.renderProjection();
    }

    renderProjection() {
      if (!this.projectionReady || disposed) return;
      this.children.removeAll(true);
      const projection = projectBoardSession(currentSession);
      const graphics = this.add.graphics();

      graphics.fillStyle(0xe8decb, 1);
      graphics.fillRect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT);
      graphics.fillStyle(0x20323b, 1);
      graphics.fillRect(0, 0, DESIGN_WIDTH, 82);

      graphics.fillStyle(0xfffbf3, 1);
      graphics.fillRoundedRect(MAP_LEFT - 8, MAP_TOP - 8, MAP_WIDTH + 16, MAP_HEIGHT + 16, 12);
      graphics.fillRoundedRect(SIDEBAR_LEFT, MAP_TOP, SIDEBAR_WIDTH, 872, 12);
      graphics.fillRoundedRect(MAP_LEFT - 8, 838, MAP_WIDTH + 16, 138, 12);

      if (this.textures.exists("cards-money-trains-board")) {
        this.add.image(MAP_LEFT + MAP_WIDTH / 2, MAP_TOP + MAP_HEIGHT / 2, "cards-money-trains-board")
          .setDisplaySize(MAP_WIDTH, MAP_HEIGHT)
          .setAlpha(0.88);
      }

      const toScreen = this.coordinateMapper(projection);
      this.drawEdges(graphics, projection, toScreen);
      this.drawNodes(graphics, projection, toScreen);
      this.drawVehicles(projection, toScreen);
      this.drawHeader(projection);
      this.drawFacilitatorPanel(projection);
      this.drawLog(projection);

      if (projection.nodes.length === 0) {
        this.add.text(MAP_LEFT + MAP_WIDTH / 2, MAP_TOP + MAP_HEIGHT / 2,
          "Ожидаются авторские узлы, координаты и начальная сеть",
          { color: "#24343d", fontFamily: "sans-serif", fontSize: "26px", align: "center" })
          .setOrigin(0.5);
      }

      if (lastError) {
        this.add.text(MAP_LEFT + MAP_WIDTH / 2, 812, lastError, {
          color: "#ffffff",
          backgroundColor: "#9e2f2f",
          padding: { x: 14, y: 8 },
          fontFamily: "sans-serif",
          fontSize: "18px",
          wordWrap: { width: MAP_WIDTH - 80 }
        }).setOrigin(0.5, 1);
      }
    }

    /** Stop late snapshot callbacks before Phaser releases scene managers. */
    stopProjection() {
      this.projectionReady = false;
    }

    private coordinateMapper(projection: BoardProjection) {
      const bounds = projection.bounds;
      if (!bounds) return (_point: CanonicalPoint) => ({
        x: MAP_LEFT + MAP_WIDTH / 2,
        y: MAP_TOP + MAP_HEIGHT / 2
      });
      const width = Math.max(1, bounds.maxX - bounds.minX);
      const height = Math.max(1, bounds.maxY - bounds.minY);
      const scale = Math.min(
        MAP_WIDTH / width,
        MAP_HEIGHT / height
      );
      const renderedWidth = width * scale;
      const renderedHeight = height * scale;
      const offsetX = MAP_LEFT + (MAP_WIDTH - renderedWidth) / 2;
      const offsetY = MAP_TOP + (MAP_HEIGHT - renderedHeight) / 2;
      return (value: CanonicalPoint) => ({
        x: offsetX + (value.x - bounds.minX) * scale,
        y: offsetY + (value.y - bounds.minY) * scale
      });
    }

    private drawEdges(
      graphics: InstanceType<typeof Phaser.GameObjects.Graphics>,
      projection: BoardProjection,
      toScreen: (point: CanonicalPoint) => CanonicalPoint
    ) {
      const edgeHighlights = new Map(
        projection.highlights
          .filter((item): item is BoardHighlightView => item.targetType === "edge")
          .map((item) => [item.targetId, item])
      );
      for (const edge of projection.edges) {
        const from = toScreen(edge.from);
        const to = toScreen(edge.to);
        const highlight = edgeHighlights.get(edge.id);
        graphics.lineStyle(highlight ? 9 : 5, edgeColor(edge), 0.95);
        graphics.lineBetween(from.x, from.y, to.x, to.y);
        if (highlight?.actionId) {
          const hitArea = this.add.zone(
            (from.x + to.x) / 2,
            (from.y + to.y) / 2,
            Phaser.Math.Distance.Between(from.x, from.y, to.x, to.y),
            48
          );
          hitArea.setRotation(Phaser.Math.Angle.Between(from.x, from.y, to.x, to.y));
          hitArea.setInteractive({ useHandCursor: true });
          hitArea.on("pointerdown", () => this.dispatchHighlight(highlight));
        }
      }
    }

    private drawNodes(
      graphics: InstanceType<typeof Phaser.GameObjects.Graphics>,
      projection: BoardProjection,
      toScreen: (point: CanonicalPoint) => CanonicalPoint
    ) {
      const highlights = new Map(
        projection.highlights
          .filter((item): item is BoardHighlightView => item.targetType === "node")
          .map((item) => [item.targetId, item])
      );
      for (const node of projection.nodes) {
        const position = toScreen(node.position);
        const highlight = highlights.get(node.id);
        graphics.fillStyle(nodeColor(node), 1);
        graphics.lineStyle(highlight ? 7 : 4, highlight ? 0x2d8f6f : 0x263b46, 1);
        graphics.fillCircle(position.x, position.y, node.objectType === "transport.waypoint" ? 15 : 23);
        graphics.strokeCircle(position.x, position.y, node.objectType === "transport.waypoint" ? 15 : 23);

        this.add.text(position.x, position.y - 34, node.label, {
          color: "#17252d",
          backgroundColor: "#fffaf0cc",
          padding: { x: 5, y: 3 },
          fontFamily: "sans-serif",
          fontSize: "18px"
        }).setOrigin(0.5, 1);

        if (highlight?.actionId) {
          // The transparent zone is at least 52×52 design pixels, which keeps
          // the target usable on touch after the FIT scale is applied.
          const hitArea = this.add.zone(position.x, position.y, 52, 52);
          hitArea.setInteractive({ useHandCursor: true });
          hitArea.on("pointerdown", () => this.dispatchHighlight(highlight));
        }
      }
    }

    private dispatchHighlight(highlight: BoardHighlightView) {
      if (!highlight.actionId) return;
      void context.dispatchAction(highlight.actionId, { ...highlight.params })
        .then(() => { lastError = null; })
        .catch((error: unknown) => {
          // The scene never applies an optimistic topology mutation. Runtime
          // refusal leaves the current snapshot in place and only adds feedback.
          lastError = errorText(error);
          this.renderProjection();
        });
    }

    private drawVehicles(
      projection: BoardProjection,
      toScreen: (point: CanonicalPoint) => CanonicalPoint
    ) {
      const nodes = new Map(projection.nodes.map((node) => [node.id, node]));
      const offsets = new Map<string, number>();
      for (const vehicle of projection.vehicles) {
        if (!vehicle.nodeId) continue;
        const node = nodes.get(vehicle.nodeId);
        if (!node) continue;
        const position = toScreen(node.position);
        const offset = offsets.get(vehicle.nodeId) ?? 0;
        offsets.set(vehicle.nodeId, offset + 1);
        this.add.text(position.x - 20 + offset * 20, position.y + 22,
          vehicle.kind === "locomotive" ? "◆" : "■", {
            color: vehicle.kind === "locomotive" ? "#273f8f" : "#8f5a27",
            fontFamily: "sans-serif",
            fontSize: "20px"
          });
      }
    }

    private drawHeader(projection: BoardProjection) {
      this.add.text(28, 17, "КАРТЫ, ДЕНЬГИ, ПОЕЗДА", {
        color: "#fff8e9",
        fontFamily: "sans-serif",
        fontStyle: "bold",
        fontSize: "26px"
      });
      this.add.text(28, 50, "Тестовый контур · данные будут заменены материалами автора", {
        color: "#cbd5d8",
        fontFamily: "sans-serif",
        fontSize: "15px"
      });
      this.add.text(DESIGN_WIDTH - 28, 22, `ХОД ${projection.turnNumber}  ·  ${phaseLabel(projection.phase)}`, {
        color: "#fff8e9",
        fontFamily: "sans-serif",
        fontStyle: "bold",
        fontSize: "22px"
      }).setOrigin(1, 0);
    }

    private drawFacilitatorPanel(projection: BoardProjection) {
      const left = SIDEBAR_LEFT + 22;
      const textWidth = SIDEBAR_WIDTH - 44;
      this.add.text(left, 126, "ТЕКУЩИЙ ЭТАП", {
        color: "#6b777c", fontFamily: "sans-serif", fontStyle: "bold", fontSize: "14px"
      });
      this.add.text(left, 151, phaseLabel(projection.phase), {
        color: "#18323d", fontFamily: "sans-serif", fontStyle: "bold", fontSize: "25px"
      });
      const phaseHint = projection.phase === "construction"
        ? `Режим: ${constructionModeLabel(projection.constructionMode)}`
        : projection.status === "finished"
          ? "Сессия завершена ведущим"
          : "Действия подтверждает сервер";
      this.add.text(left, 185, phaseHint, {
        color: "#54656c", fontFamily: "sans-serif", fontSize: "16px", wordWrap: { width: textWidth }
      });

      this.add.text(left, 230, "КОМАНДЫ", {
        color: "#6b777c", fontFamily: "sans-serif", fontStyle: "bold", fontSize: "14px"
      });
      if (projection.teams.length === 0) {
        this.add.text(left, 258, "Данные команд пока не переданы", {
          color: "#6b777c", fontFamily: "sans-serif", fontSize: "16px", wordWrap: { width: textWidth }
        });
      }
      projection.teams.slice(0, 5).forEach((team, index) => {
        const top = 258 + index * 76;
        this.add.text(left, top, truncate(team.label, 28), {
          color: "#18323d", fontFamily: "sans-serif", fontStyle: "bold", fontSize: "18px"
        });
        this.add.text(left, top + 25,
          `${team.coins === null ? "—" : team.coins} мон.  ·  ${team.locomotives} лок.  ·  ${team.wagons} ваг.`, {
            color: "#53646b", fontFamily: "sans-serif", fontSize: "16px"
          });
      });

      const enabledActions = projection.availableActions.filter((action) => action.disabled !== true);
      const disabledActions = projection.availableActions.filter((action) => action.disabled === true);
      this.add.text(left, 590, "ДЕЙСТВИЯ", {
        color: "#6b777c", fontFamily: "sans-serif", fontStyle: "bold", fontSize: "14px"
      });
      this.add.text(left, 617,
        enabledActions.length > 0
          ? `Доступно: ${enabledActions.length}. Кнопки находятся сразу под картой.`
          : "Сейчас сервер не передал доступных действий.", {
          color: "#18323d", fontFamily: "sans-serif", fontSize: "17px", wordWrap: { width: textWidth }
        });

      let actionTop = 674;
      for (const action of disabledActions.slice(0, 3)) {
        const reason = action.disabledReason ?? "Причина не передана сервером";
        this.add.text(left, actionTop, `Недоступно: ${truncate(action.label, 31)}`, {
          color: "#7d3934", fontFamily: "sans-serif", fontSize: "15px", wordWrap: { width: textWidth }
        });
        this.add.text(left, actionTop + 22, truncate(reason, 72), {
          color: "#6b5a58", fontFamily: "sans-serif", fontSize: "14px", wordWrap: { width: textWidth }
        });
        actionTop += 68;
      }

      this.add.text(left, 918, "Клавиатура: используйте обычные кнопки под полем. Карта поддерживает мышь и касание.", {
        color: "#68767b", fontFamily: "sans-serif", fontSize: "14px", wordWrap: { width: textWidth }
      });
    }

    private drawLog(projection: BoardProjection) {
      this.add.text(MAP_LEFT + 12, 854, "ЖУРНАЛ ПОДТВЕРЖДЁННЫХ ДЕЙСТВИЙ", {
        color: "#6b777c", fontFamily: "sans-serif", fontStyle: "bold", fontSize: "14px"
      });
      const entries = projection.log.slice(-3).reverse();
      if (entries.length === 0) {
        this.add.text(MAP_LEFT + 12, 884, "Записей пока нет — первая подтверждённая операция появится здесь.", {
          color: "#617178", fontFamily: "sans-serif", fontSize: "17px"
        });
        return;
      }
      entries.forEach((entry, index) => {
        this.add.text(MAP_LEFT + 12, 884 + index * 28,
          `${index === 0 ? "Последнее" : "Ранее"}: ${truncate(entry.summary, 112)}`, {
            color: index === 0 ? "#18323d" : "#617178",
            fontFamily: "sans-serif",
            fontSize: index === 0 ? "17px" : "15px"
          });
      });
    }
  }

  const scene = new CardsMoneyTrainsScene();
  return {
    scene,
    updateSession(session) {
      if (disposed) return;
      currentSession = session;
      lastError = null;
      scene.renderProjection();
    },
    destroy() {
      if (disposed) return;
      disposed = true;
      lastError = null;
      scene.stopProjection();
      if (scene.sys?.isActive()) {
        scene.children.removeAll(true);
      }
    },
    getAccessibleActions(session): readonly AccessibleBoardAction[] {
      return projectBoardSession(session).availableActions.map((action) => ({ ...action }));
    }
  };
};
