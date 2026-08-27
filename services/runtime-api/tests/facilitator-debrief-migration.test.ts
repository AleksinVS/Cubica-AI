import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("facilitator debrief storage retains attempts, one draft and no duplicated journal", async () => {
  const up = await readFile(new URL("../migrations/008_facilitator_debrief.up.sql", import.meta.url), "utf8");
  const down = await readFile(new URL("../migrations/008_facilitator_debrief.down.sql", import.meta.url), "utf8");

  assert.match(up, /session_id UUID NOT NULL REFERENCES game_sessions\(id\) ON DELETE CASCADE/u);
  assert.match(up, /status IN \('generating', 'ready', 'failed'\)/u);
  assert.match(up, /WHERE status = 'generating'/u);
  assert.match(up, /WHERE status = 'ready'/u);
  assert.match(up, /journal_sha256 TEXT NOT NULL/u);
  assert.match(up, /input_snapshot_without_journal JSONB NOT NULL/u);
  assert.doesNotMatch(up, /journal_(?:json|bytes|content)|public_journal JSONB/u);
  assert.match(up, /raw_response_utf8 TEXT/u);
  assert.match(up, /draft JSONB/u);
  assert.match(up, /error JSONB/u);
  assert.match(down, /^DROP TABLE IF EXISTS facilitator_debrief_attempts;\n$/u);
});
