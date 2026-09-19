/** Discovery hints only. Runtime authorization and saved state never live here. */
export function debugCatalogKey(gameId: string, sourceId: string): string {
  return `cubica:debug-origins:${encodeURIComponent(gameId)}:${encodeURIComponent(sourceId)}`;
}

export function readDebugOrigins(key: string, storage: Pick<Storage, "getItem"> = localStorage): string[] {
  const text = storage.getItem(key);
  if (text === null) return [];
  const value: unknown = JSON.parse(text);
  if (!Array.isArray(value) || value.length > 10_000 ||
    !value.every(id => typeof id === "string" && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,159}$/.test(id))) {
    throw new Error("Не удалось прочитать список сохранений этого проекта.");
  }
  return [...new Set(value as string[])];
}

export function rememberDebugOrigin(key: string, sessionId: string, storage: Storage = localStorage): void {
  const origins = readDebugOrigins(key, storage);
  if (origins.includes(sessionId)) return;
  if (origins.length >= 10_000) throw new Error("Список сохранений заполнен. Удалите ненужные сохранения.");
  // A storage failure must stop Save before the server creates an undiscoverable checkpoint.
  storage.setItem(key, JSON.stringify([...origins, sessionId]));
}

export function forgetDebugOrigin(key: string, sessionId: string, storage: Storage = localStorage): void {
  const origins = readDebugOrigins(key, storage);
  if (origins.includes(sessionId)) storage.setItem(key, JSON.stringify(origins.filter(id => id !== sessionId)));
}
