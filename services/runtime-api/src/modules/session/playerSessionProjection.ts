/**
 * Builds the bounded state returned to an ordinary player client.
 *
 * Platform-owned randomness and deck order must never leave runtime: exposing
 * either would let a browser predict future dice or cards. Other legacy game
 * secret fields remain temporarily visible because Antarctica still reads one
 * of them; that separate migration is tracked as architectural debt.
 */
type RuntimeState = Record<string, unknown>;

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const projectPlayerSessionState = (state: RuntimeState): RuntimeState => {
  const projected = structuredClone(state);
  if (!isObjectRecord(projected.secret)) {
    return projected;
  }

  delete projected.secret.random;
  delete projected.secret.decks;
  if (Object.keys(projected.secret).length === 0) {
    delete projected.secret;
  }

  return projected;
};
