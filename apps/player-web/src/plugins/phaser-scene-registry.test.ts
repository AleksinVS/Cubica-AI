/** Regression tests for ownership-aware Phaser factory registration. */

import { describe, expect, it, vi } from "vitest";

import {
  registerPhaserSceneFactory,
  resolvePhaserSceneFactory,
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
});
