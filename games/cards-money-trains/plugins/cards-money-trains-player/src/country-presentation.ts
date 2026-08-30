/**
 * Safe, game-owned presentation helpers for the Guinea country catalogue.
 *
 * Country narratives come from immutable player-facing content, not from the
 * mutable session snapshot. This module only bounds and sanitizes that public
 * content for rendering; it neither infers country geometry nor changes game
 * state when a facilitator opens an information panel.
 */

export interface CountryContentView {
  readonly id: string;
  readonly title: string;
  readonly description: string;
}

export type NodePointerIntent =
  | "road-selection"
  | "server-highlight"
  | "country-information"
  | "none";

const MAX_COUNTRIES = 10;
const MAX_COUNTRY_ID_LENGTH = 64;
const MAX_COUNTRY_TITLE_LENGTH = 80;
const MAX_COUNTRY_DESCRIPTION_LENGTH = 4_000;
const COUNTRY_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

type JsonRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is JsonRecord =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const boundedText = (value: unknown, maximumLength: number): string | null => {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= maximumLength
    ? normalized
    : null;
};

/** Sanitize the short public-state reference before it enters a render key. */
export function readCountryId(value: unknown): string | null {
  const id = boundedText(value, MAX_COUNTRY_ID_LENGTH);
  return id && COUNTRY_ID_PATTERN.test(id) ? id : null;
}

/**
 * Read at most ten complete catalogue records from public manifest content.
 *
 * The catalog schema is validated before publication. These defensive checks
 * protect the browser from a stale or malformed package without replacing that
 * JSON Schema source of truth. Invalid or duplicate records are omitted as a
 * whole, so the panel never mixes fields from different countries.
 */
export function readCountryCatalogue(value: unknown): readonly CountryContentView[] {
  if (!isRecord(value) || !Array.isArray(value.countries)) return Object.freeze([]);

  const seenIds = new Set<string>();
  const countries: CountryContentView[] = [];
  for (const raw of value.countries.slice(0, MAX_COUNTRIES)) {
    if (!isRecord(raw)) continue;
    const id = readCountryId(raw.id);
    const title = boundedText(raw.title, MAX_COUNTRY_TITLE_LENGTH);
    const description = boundedText(
      raw.description,
      MAX_COUNTRY_DESCRIPTION_LENGTH
    );
    if (
      !id
      || seenIds.has(id)
      || !title
      || !description
    ) continue;

    seenIds.add(id);
    countries.push(Object.freeze({ id, title, description }));
  }
  return Object.freeze(countries);
}

/**
 * Move through the already bounded catalogue without coupling navigation to
 * map geometry. Wrapping keeps the compact two-button panel useful on narrow
 * facilitator screens and also exposes the country that has no terminal.
 */
export function countryAtOffset(
  countries: readonly CountryContentView[],
  currentCountryId: string | null,
  offset: number
): CountryContentView | null {
  if (countries.length === 0 || !Number.isSafeInteger(offset)) return null;
  const currentIndex = currentCountryId === null
    ? -1
    : countries.findIndex((country) => country.id === currentCountryId);
  const normalizedStart = currentIndex === -1 ? 0 : currentIndex;
  const targetIndex = (
    (normalizedStart + offset) % countries.length + countries.length
  ) % countries.length;
  return countries[targetIndex] ?? null;
}

/**
 * Keep the established map-click priority explicit and browser-testable.
 *
 * Construction selection wins first, then a server-published action. A
 * country panel is therefore only an informational fallback for an otherwise
 * idle numbered terminal.
 */
export function resolveNodePointerIntent(input: {
  readonly canSelectRoad: boolean;
  readonly hasServerHighlightAction: boolean;
  readonly hasCountryInformation: boolean;
}): NodePointerIntent {
  if (input.canSelectRoad) return "road-selection";
  if (input.hasServerHighlightAction) return "server-highlight";
  if (input.hasCountryInformation) return "country-information";
  return "none";
}
