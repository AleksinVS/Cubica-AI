/**
 * Универсальное преобразование значения в строку.
 * null/undefined -> "—", объект -> JSON.stringify, иначе String.
 */
export function formatValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "—";
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

/**
 * Чтение числа с фоллбеком.
 */
export function readNumber(value: unknown, fallback: number): number {
  return typeof value === "number" ? value : fallback;
}
