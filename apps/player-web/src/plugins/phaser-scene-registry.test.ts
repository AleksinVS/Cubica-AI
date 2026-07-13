/** Regression tests for ownership-aware Phaser factory registration. */

import { describe, expect, it, vi } from "vitest";

import {
  registerAccessibleBoardActionsProvider,
  registerPhaserSceneFactory,
  resolveAccessibleBoardActionsProvider,
  resolvePhaserSceneFactory,
  type AccessibleBoardActionsProvider,
  type PhaserSceneFactory
} from "./phaser-scene-registry";

describe("phaser scene registry", () => {
  it("does not let an older disposer remove a newer registration", () => {
    const older = vi.fn() as unknown as PhaserSceneFactory;
    const newer = vi.fn() as unknown as PhaserSceneFactory;
    const disposeOlder = registerPhaserSceneFactory("neutral-board", older);
    const disposeNewer = registerPhaserSceneFactory("neutral-board", newer);

    disposeOlder();
    expect(resolvePhaserSceneFactory("neutral-board")).toBe(newer);

    disposeNewer();
    expect(resolvePhaserSceneFactory("neutral-board")).toBeUndefined();
  });

  it("does not let an older disposer remove a newer accessible-actions provider", () => {
    const older = vi.fn() as unknown as AccessibleBoardActionsProvider;
    const newer = vi.fn() as unknown as AccessibleBoardActionsProvider;
    const disposeOlder = registerAccessibleBoardActionsProvider("neutral-board", older);
    const disposeNewer = registerAccessibleBoardActionsProvider("neutral-board", newer);

    disposeOlder();
    expect(resolveAccessibleBoardActionsProvider("neutral-board")).toBe(newer);

    disposeNewer();
    expect(resolveAccessibleBoardActionsProvider("neutral-board")).toBeUndefined();
  });
});
