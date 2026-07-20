/**
 * Human-readable, bounded label for the current news transition.
 *
 * The complete author text remains in the public snapshot. The map banner keeps
 * only a short orientation cue so it cannot cover the facilitator's workspace.
 */

import type { BoardNewsView } from "./board-state.ts";

const MAX_NEWS_SUMMARY_LENGTH = 110;

/** Format a revealed card and safely fall back to its stable id. */
export function newsBannerLabel(
  news: BoardNewsView | null | undefined,
  fallbackId: string
): string {
  const heading = news?.number !== null && news?.number !== undefined
    ? `Новость №${news.number}`
    : `Новость: ${fallbackId}`;
  const normalizedText = news?.text?.replace(/\s+/gu, " ").trim() ?? "";
  if (normalizedText === "") return heading;
  const summary = normalizedText.length <= MAX_NEWS_SUMMARY_LENGTH
    ? normalizedText
    : `${normalizedText.slice(0, MAX_NEWS_SUMMARY_LENGTH - 1).trimEnd()}…`;
  return `${heading}: ${summary}`;
}
