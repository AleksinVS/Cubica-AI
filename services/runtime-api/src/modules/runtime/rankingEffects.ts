/**
 * Explainable grouped economic ranking for manifest-driven games.
 *
 * The platform sums one declared participant balance and declared owned-asset
 * values. It does not know team kinds, vehicle names, or a game-specific tie
 * breaker; equal scores remain equal and expose all winners.
 */
import type { GameManifestDeterministicEffect } from "@cubica/contracts-manifest";

type RuntimeState = Record<string, unknown>;
type JsonRecord = Record<string, unknown>;
type RankingEffect = Extract<GameManifestDeterministicEffect, { op: "ranking.compute" }>;

const SAFE_IDENTIFIER_PATTERN = /^(?!(?:__proto__|constructor|prototype)$)[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const forbiddenSegments = new Set(["__proto__", "constructor", "prototype"]);

const isRecord = (value: unknown): value is JsonRecord =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const safeIdentifier = (value: unknown, label: string): string => {
  if (typeof value !== "string" || !SAFE_IDENTIFIER_PATTERN.test(value)) {
    throw new Error(`${label} must be a safe identifier`);
  }
  return value;
};

const nonnegativeInteger = (value: unknown, label: string): number => {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`${label} must be a finite non-negative integer`);
  }
  return value as number;
};

const decodePointerSegment = (segment: string) => segment.replace(/~1/g, "/").replace(/~0/g, "~");

const pointerParts = (path: string): Array<string> => {
  if (!path.startsWith("/public/")) throw new Error("Ranking paths must remain under /public/");
  const parts = path.slice(1).split("/").map(decodePointerSegment);
  if (parts.some((part) => forbiddenSegments.has(part))) {
    throw new Error("Ranking path contains a forbidden segment");
  }
  return parts;
};

const readPublicPointer = (state: RuntimeState, path: string): unknown => {
  let current: unknown = state;
  for (const part of pointerParts(path)) {
    if (!isRecord(current)) return undefined;
    current = current[part];
  }
  return current;
};

const writePublicPointer = (state: RuntimeState, path: string, value: unknown) => {
  const parts = pointerParts(path);
  let current = state;
  for (const part of parts.slice(0, -1)) {
    if (!isRecord(current[part])) current[part] = {};
    current = current[part] as JsonRecord;
  }
  current[parts[parts.length - 1]] = value;
};

/** Compute and persist one immutable ranking snapshot. */
export const applyRankingEffect = (state: RuntimeState, effect: RankingEffect): Record<string, unknown> => {
  const balanceAttribute = safeIdentifier(effect.balanceAttribute, "Ranking balance attribute");
  const participants = readPublicPointer(state, effect.participantCollectionPath);
  if (!isRecord(participants)) throw new Error("Ranking participant collection is unavailable");
  const assetCollections = effect.assetSources.map((source) => {
    const collection = readPublicPointer(state, source.collectionPath);
    if (!isRecord(collection)) throw new Error(`Ranking asset collection "${source.collectionPath}" is unavailable`);
    return {
      ...source,
      ownerAttribute: safeIdentifier(source.ownerAttribute, "Ranking asset owner attribute"),
      valueAttribute: safeIdentifier(source.valueAttribute, "Ranking asset value attribute"),
      collection
    };
  });

  const resultGroups: JsonRecord = {};
  for (const group of effect.groups) {
    const groupId = safeIdentifier(group.id, "Ranking group id");
    if (resultGroups[groupId] !== undefined) throw new Error(`Ranking group "${groupId}" is duplicated`);
    const participantIds = group.participantIds.map((id) => safeIdentifier(id, "Ranking participant id"));
    const standings = participantIds.map((participantId) => {
      const participant = isRecord(participants[participantId]) ? participants[participantId] as JsonRecord : undefined;
      if (!participant) throw new Error(`Ranking participant "${participantId}" is unavailable`);
      const balance = nonnegativeInteger(
        participant[balanceAttribute],
        `Ranking balance for participant "${participantId}"`
      );
      const assets: Array<Record<string, unknown>> = [];
      let assetValue = 0;
      for (const source of assetCollections) {
        for (const [assetId, candidate] of Object.entries(source.collection)) {
          if (!isRecord(candidate)) continue;
          const attributes = isRecord(candidate.attributes) ? candidate.attributes : {};
          if (attributes[source.ownerAttribute] !== participantId) continue;
          const value = nonnegativeInteger(
            attributes[source.valueAttribute],
            `Ranking asset value for "${assetId}"`
          );
          assetValue += value;
          if (!Number.isSafeInteger(assetValue)) throw new Error("Ranking asset total exceeds safe integer range");
          assets.push({ assetId, collectionPath: source.collectionPath, value });
        }
      }
      const score = balance + assetValue;
      if (!Number.isSafeInteger(score)) throw new Error("Ranking score exceeds safe integer range");
      return { participantId, balance, assetValue, score, assets };
    }).sort((left, right) => right.score - left.score || left.participantId.localeCompare(right.participantId));

    let previousScore: number | undefined;
    let previousRank = 0;
    const ranked = standings.map((entry, index) => {
      const rank = previousScore === entry.score ? previousRank : index + 1;
      previousScore = entry.score;
      previousRank = rank;
      return { ...entry, rank };
    });
    const winningScore = ranked[0]?.score;
    const winners = ranked.filter((entry) => entry.score === winningScore).map((entry) => entry.participantId);
    resultGroups[groupId] = {
      standings: ranked,
      winners,
      tiedForFirst: winners.length > 1
    };
  }

  const ranking = { groups: resultGroups };
  writePublicPointer(state, effect.storePath, ranking);
  return { storePath: effect.storePath, groupIds: Object.keys(resultGroups), groups: resultGroups };
};
