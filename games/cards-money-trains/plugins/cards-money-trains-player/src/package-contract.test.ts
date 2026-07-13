/** Focused invariants for the compiled game package and its bounded fixtures. */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

const readJson = (relativePath: string) =>
  JSON.parse(readFileSync(new URL(relativePath, import.meta.url), "utf8")) as Record<string, unknown>;

test("compiled manifest exposes facilitator-only phase controls but no incomplete transport model", () => {
  const manifest = readJson("../../../game.manifest.json");
  const config = manifest.config as Record<string, unknown>;
  const actions = manifest.actions as Record<string, Record<string, unknown>>;

  assert.equal(config.sessionMode, "facilitated");
  assert.equal(manifest.networkModels, undefined);
  assert.equal(actions["construction.road.build"], undefined);
  assert.equal(actions["construction.waypoint.build"], undefined);
  assert.deepEqual(actions["construction.phase.finish"]?.allowedSessionRoles, ["facilitator"]);
  assert.deepEqual(actions["session.finish.confirm"]?.allowedSessionRoles, ["facilitator"]);
});

test("normal-start policy and demonstration fixture stay explicitly distinct", () => {
  const normal = readJson("../../../authoring/fixtures/normal-start-policy.json");
  const demonstration = readJson("../../../authoring/fixtures/demonstration-start.json");
  const teamTypes = normal.teamTypes as Record<string, Record<string, unknown>>;
  const teams = demonstration.teams as Array<Record<string, unknown>>;

  assert.equal(normal.startingCoinsPerTeam, 10);
  assert.equal(teamTypes.logistics_company?.startingWagons, 2);
  assert.equal(teamTypes.locomotive_guild?.startingLocomotives, 1);
  assert.equal(demonstration.specialFixture, true);
  assert.deepEqual(teams.map((team) => team.coins), [10, 2, 1, 5]);
  assert.equal((demonstration.contentStatus as Record<string, unknown>).initialTopology, "not-provided");
});

test("ADR-063 registry stays minimal while provenance verifies the optimized derivative", () => {
  const registry = readJson("../../../assets/assets.json");
  const provenance = readJson("../../../asset-provenance.json");
  const assets = registry.assets as Array<Record<string, unknown>>;
  const asset = assets[0];
  const delivery = provenance.delivery as Record<string, unknown>;
  const image = readFileSync(new URL("../../../assets/images/guinea-map.webp", import.meta.url));
  const digest = createHash("sha256").update(image).digest("hex");

  assert.deepEqual(Object.keys(registry).sort(), ["assets", "gameId"]);
  assert.deepEqual(Object.keys(asset ?? {}).sort(), ["file", "id", "kind", "origin"]);
  assert.equal(asset?.id, "board-guinea-optimized");
  assert.equal(asset?.file, "images/guinea-map.webp");
  assert.equal(digest, delivery.sha256);
  assert.equal((provenance.rights as Record<string, unknown>).status, "confirmed");
  assert.equal((provenance.rights as Record<string, unknown>).publicationAllowed, true);
  assert.equal((provenance.rights as Record<string, unknown>).modificationAllowed, true);
});

test("normative board declarations stay aligned with the 5079 by 3627 author plane", () => {
  const manifest = readJson("../../../game.manifest.json");
  const ui = readJson("../../../ui/web/ui.manifest.json");
  const provenance = readJson("../../../asset-provenance.json");
  const content = ((manifest.content as Record<string, unknown>).data as Record<string, unknown>);
  const board = content.board as Record<string, unknown>;
  const state = manifest.state as Record<string, unknown>;
  const publicState = state.public as Record<string, unknown>;
  const runtimeBoard = publicState.board as Record<string, unknown>;
  const bounds = runtimeBoard.canonicalBounds as Record<string, unknown>;
  const screens = ui.screens as Record<string, Record<string, unknown>>;
  const root = screens.facilitator.root as Record<string, unknown>;
  const children = root.children as Array<Record<string, unknown>>;
  const boardZone = children.find((child) =>
    (child.props as Record<string, unknown> | undefined)?.workspaceSlot === "board"
  );
  const surface = (boardZone?.children as Array<Record<string, unknown>> | undefined)?.[0];
  const surfaceProps = surface?.props as Record<string, unknown> | undefined;
  const source = provenance.source as Record<string, unknown>;

  assert.deepEqual(
    { width: board.designWidth, height: board.designHeight },
    { width: 5079, height: 3627 }
  );
  assert.deepEqual(
    { width: surfaceProps?.designWidth, height: surfaceProps?.designHeight },
    { width: board.designWidth, height: board.designHeight }
  );
  assert.deepEqual(
    { width: bounds.maxX, height: bounds.maxY },
    { width: board.designWidth, height: board.designHeight }
  );
  assert.deepEqual(
    { width: source.width, height: source.height },
    { width: board.designWidth, height: board.designHeight }
  );
});
