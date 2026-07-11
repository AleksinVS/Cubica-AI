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
const BOARD_PADDING = 72;

const edgeColor = (edge: BoardEdgeView) => {
  if (edge.visualState === "blocked") return 0xc94c4c;
  if (edge.visualState === "building") return 0xe0a33a;
  return 0x374b59;
};

const nodeColor = (node: BoardNodeView) =>
  node.objectType === "transport.waypoint" ? 0xe5a338 : 0xf4ead5;

const errorText = (error: unknown) => error instanceof Error ? error.message : "Действие отклонено runtime";

/** Build a scene instance exclusively from platform-injected Phaser. */
export const createCardsMoneyTrainsScene: PhaserSceneFactory = (
  context: PhaserSceneContext
): InteractiveBoardSceneHandle => {
  const Phaser = context.Phaser;
  let currentSession = context.session;
  let lastError: string | null = null;

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
      this.projectionReady = true;
      this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
        this.projectionReady = false;
      });
      this.cameras.main.setBackgroundColor("#f3ead8");
      this.renderProjection();
    }

    renderProjection() {
      if (!this.projectionReady) return;
      this.children.removeAll(true);
      const projection = projectBoardSession(currentSession);
      const graphics = this.add.graphics();

      graphics.fillStyle(0xf3ead8, 1);
      graphics.fillRect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT);

      if (this.textures.exists("cards-money-trains-board")) {
        this.add.image(DESIGN_WIDTH / 2, DESIGN_HEIGHT / 2, "cards-money-trains-board")
          .setDisplaySize(DESIGN_WIDTH, DESIGN_HEIGHT)
          .setAlpha(0.82);
      }

      const toScreen = this.coordinateMapper(projection);
      this.drawEdges(graphics, projection, toScreen);
      this.drawNodes(graphics, projection, toScreen);
      this.drawVehicles(projection, toScreen);
      this.drawTeamSummary(projection);

      if (projection.nodes.length === 0) {
        this.add.text(DESIGN_WIDTH / 2, DESIGN_HEIGHT / 2,
          "Ожидаются авторские узлы, координаты и начальная сеть",
          { color: "#24343d", fontFamily: "sans-serif", fontSize: "28px", align: "center" })
          .setOrigin(0.5);
      }

      this.add.text(34, 24, `Ход ${projection.turnNumber} · этап: ${projection.phase}`, {
        color: "#17252d",
        backgroundColor: "#fffaf0dd",
        padding: { x: 12, y: 8 },
        fontFamily: "sans-serif",
        fontSize: "22px"
      });

      if (lastError) {
        this.add.text(DESIGN_WIDTH / 2, DESIGN_HEIGHT - 34, lastError, {
          color: "#ffffff",
          backgroundColor: "#9e2f2f",
          padding: { x: 14, y: 8 },
          fontFamily: "sans-serif",
          fontSize: "20px"
        }).setOrigin(0.5, 1);
      }
    }

    private coordinateMapper(projection: BoardProjection) {
      const bounds = projection.bounds;
      if (!bounds) return (_point: CanonicalPoint) => ({ x: DESIGN_WIDTH / 2, y: DESIGN_HEIGHT / 2 });
      const width = Math.max(1, bounds.maxX - bounds.minX);
      const height = Math.max(1, bounds.maxY - bounds.minY);
      const scale = Math.min(
        (DESIGN_WIDTH - BOARD_PADDING * 2) / width,
        (DESIGN_HEIGHT - BOARD_PADDING * 2) / height
      );
      const renderedWidth = width * scale;
      const renderedHeight = height * scale;
      const offsetX = (DESIGN_WIDTH - renderedWidth) / 2;
      const offsetY = (DESIGN_HEIGHT - renderedHeight) / 2;
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
        graphics.lineStyle(highlight ? 10 : 6, edgeColor(edge), 0.95);
        graphics.lineBetween(from.x, from.y, to.x, to.y);
        if (highlight?.actionId) {
          const hitArea = this.add.zone(
            (from.x + to.x) / 2,
            (from.y + to.y) / 2,
            Phaser.Math.Distance.Between(from.x, from.y, to.x, to.y),
            28
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

        const label = this.add.text(position.x, position.y - 34, node.label, {
          color: "#17252d",
          backgroundColor: "#fffaf0cc",
          padding: { x: 5, y: 3 },
          fontFamily: "sans-serif",
          fontSize: "18px"
        }).setOrigin(0.5, 1);

        if (highlight?.actionId) {
          label.setInteractive({ useHandCursor: true });
          label.on("pointerdown", () => this.dispatchHighlight(highlight));
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

    private drawTeamSummary(projection: BoardProjection) {
      if (projection.teams.length === 0) return;
      const lines = projection.teams.map((team) =>
        `${team.label}: ${team.coins === null ? "—" : team.coins} мон.`
      );
      this.add.text(DESIGN_WIDTH - 28, 24, lines.join("\n"), {
        color: "#17252d",
        backgroundColor: "#fffaf0dd",
        padding: { x: 12, y: 8 },
        fontFamily: "sans-serif",
        fontSize: "18px",
        align: "right"
      }).setOrigin(1, 0);
    }
  }

  const scene = new CardsMoneyTrainsScene();
  return {
    scene,
    updateSession(session) {
      currentSession = session;
      lastError = null;
      scene.renderProjection();
    },
    destroy() {
      lastError = null;
      if (scene.sys?.isActive()) {
        scene.children.removeAll(true);
      }
    },
    getAccessibleActions(session): readonly AccessibleBoardAction[] {
      return projectBoardSession(session).availableActions.map((action) => ({ ...action }));
    }
  };
};
