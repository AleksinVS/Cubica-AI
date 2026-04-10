/**
 * Smoke checks (short automated checks that validate the main flow) for the Antarctica Next.js player.
 * Validates the UI entry point and the presenter (the MVP layer that connects UI and game logic) command dispatch in local and remote modes.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findEntryPoint } from '../src/app/utils/renderUtils.js';
import { createActionPresenter } from '../src/app/sdk/presenter.js';

/**
 * Minimal assertion helper for the smoke script.
 */
const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');

/**
 * Loads a JSON file from the repository root.
 */
const loadJson = async (relativePath) => {
  const absolutePath = path.join(repoRoot, relativePath);
  const raw = await readFile(absolutePath, 'utf8');
  return JSON.parse(raw);
};

/**
 * Executes the smoke checks and reports failures via exit code.
 */
const main = async () => {
  const gameManifest = await loadJson('games/antarctica/game.manifest.json');
  const uiManifest = await loadJson('games/antarctica/ui/web/ui.manifest.json');

  const entryPoint = findEntryPoint({ game: gameManifest, ui: uiManifest });
  assert(entryPoint, 'UI entry point is missing.');
  assert(uiManifest.screens?.[entryPoint], `Entry point screen "${entryPoint}" is not defined.`);

  let remoteDispatch = null;
  const presenterRemote = createActionPresenter({
    mode: 'remote',
    replaceState: () => {
      throw new Error('replaceState must not be used in remote mode.');
    },
    dispatchCommand: async (command) => {
      remoteDispatch = command;
    },
    loadFixture: () => {
      throw new Error('loadFixture must not be used in remote mode.');
    }
  });

  await presenterRemote({ command: 'showHint', payload: { source: 'smoke' } }, { componentId: 'test' });
  assert(remoteDispatch?.type === 'showHint', 'Remote presenter did not dispatch the command.');
  assert(remoteDispatch?.payload?.source === 'smoke', 'Remote presenter payload is incorrect.');

  let localReplaceState = null;
  const presenterLocal = createActionPresenter({
    mode: 'local',
    replaceState: (state) => {
      localReplaceState = state;
    },
    dispatchCommand: null,
    loadFixture: () => ({ fixture: 'ok' })
  });

  await presenterLocal({ command: 'showHint', payload: {} }, { componentId: 'test' });
  assert(localReplaceState?.fixture === 'ok', 'Local presenter did not load a fixture.');

  console.log('[smoke] OK: entry point and presenter behavior validated.');
};

main().catch((error) => {
  console.error('[smoke] FAILED:', error.message);
  process.exitCode = 1;
});

