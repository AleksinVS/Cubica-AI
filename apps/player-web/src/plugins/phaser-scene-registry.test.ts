/** Regression tests for ownership-aware Phaser factory registration. */

import { describe, expect, it, vi } from "vitest";

import {
  registerAccessibleBoardActionsProvider,
  registerFacilitatorDebriefAvailabilityProvider,
  registerPhaserSceneFactory,
  resolveAccessibleBoardActionsProvider,
  resolveFacilitatorDebriefAvailabilityProvider,
  resolvePhaserSceneFactory,
  type AccessibleBoardActionsProvider,
  type FacilitatorDebriefAvailabilityProvider,
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

  it("does not let an older disposer remove a newer debrief eligibility provider", () => {
    const older = vi.fn(() => false);
    const newer = vi.fn(() => true);
    const disposeOlder = registerFacilitatorDebriefAvailabilityProvider("neutral-board", older);
    const disposeNewer = registerFacilitatorDebriefAvailabilityProvider("neutral-board", newer);

    disposeOlder();
    expect(resolveFacilitatorDebriefAvailabilityProvider("neutral-board")).toBe(newer);

    disposeNewer();
    expect(resolveFacilitatorDebriefAvailabilityProvider("neutral-board")).toBeUndefined();
  });

  it("resolves an eligibility provider as a pure snapshot projection", () => {
    const provider = vi.fn<FacilitatorDebriefAvailabilityProvider>(() => true);
    const dispose = registerFacilitatorDebriefAvailabilityProvider("neutral-debrief", provider);
    const snapshot = { sessionId: "session-1", gameId: "neutral-debrief" } as Parameters<FacilitatorDebriefAvailabilityProvider>[0];

    expect(resolveFacilitatorDebriefAvailabilityProvider("neutral-debrief")?.(snapshot)).toBe(true);
    expect(provider).toHaveBeenCalledWith(snapshot);
    dispose();
  });
});
