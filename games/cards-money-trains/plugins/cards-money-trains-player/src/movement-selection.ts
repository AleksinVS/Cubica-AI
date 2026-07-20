/**
 * Game-local input shaping for one locomotive traversal.
 *
 * The map chooses only a public road reference. Runtime owns the current
 * locomotive and validates incidence, availability, capacity and action points;
 * keeping those facts out of this helper prevents a second client-side ruleset.
 */

export const MOVEMENT_TRAVERSE_ACTION_ID = "movement.locomotive.traverse";

/** Copy the selected public edge id into the exact bounded action payload. */
export function movementTraverseParams(
  edgeId: string
): Readonly<{ edgeId: string }> {
  return { edgeId };
}
