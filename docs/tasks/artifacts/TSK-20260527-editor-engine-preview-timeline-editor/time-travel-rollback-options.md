# Time-Travel Rollback Options

## Оглавление

- [1. Понимание вопроса](#1-понимание-вопроса)
- [2. Текущий факт](#2-текущий-факт)
- [3. Варианты](#3-варианты)
- [4. Минимальный безопасный следующий шаг](#4-минимальный-безопасный-следующий-шаг)
- [5. Вопрос на согласование](#5-вопрос-на-согласование)

## 1. Понимание вопроса

Нужно продолжить preview-first editor без того, чтобы timeline rollback случайно стал историей изменений authoring JSON.

**Timeline rollback** здесь означает возврат состояния preview-сессии к выбранному событию прохождения. Это не undo документа, не Git rollback и не изменение манифеста.

## 2. Текущий факт

Уже есть:

- core-модель `PreviewPlaythroughTrace`, event log, snapshots and `buildPreviewTraceRestorePlan` in `packages/editor-engine`;
- timeline band в `apps/editor-web`, который показывает chronology из `root.logic.flows[].steps[]`;
- iframe bridge from `player-web` to `editor-web` for preview entity descriptors;
- runtime session creation and action dispatch through `runtime-api`.

Нет:

- writer-а trace files under `.tmp/editor-playthroughs/`;
- preview snapshot event protocol;
- способа попросить preview player/runtime восстановить состояние по snapshot/replay plan;
- e2e проверки, что rollback preview не меняет dirty state authoring документа.

## 3. Варианты

### Вариант A. Editor-only Recorded Trace UI

Editor records local UI events: preview selection, timeline step selection, prompt submission and preview metadata refresh. Rollback only selects a prior trace entry in editor UI and updates selection/context. Runtime session state does not change.

Плюсы:

- минимальный риск;
- не меняет runtime-api/player-web contracts;
- можно сделать как UI baseline и e2e for "does not mutate authoring JSON".

Минусы:

- это не настоящий time travel игры;
- нельзя вернуться к прошлому состоянию player iframe after runtime actions.

### Вариант B. Runtime Snapshot Restore API

Runtime-api owns preview rollback. Editor records runtime snapshots and asks runtime-api to restore a preview session to a selected snapshot or event sequence. Player-web then reloads the session snapshot.

Плюсы:

- rollback меняет реальное состояние preview-сессии;
- authoritative state остается на стороне runtime-api;
- модель хорошо отделяет authoring undo from preview rollback.

Минусы:

- нужен новый runtime-api contract for preview-only snapshot restore;
- нужно явно запретить production use or protect it by editor-preview content source;
- требуется e2e across editor-web, runtime-api and player-web.

### Вариант C. Player-local Snapshot Restore

Player-web keeps preview-only snapshots in browser memory and can restore visual state locally through iframe messages from editor-web. Runtime-api session remains unchanged until the next runtime action.

Плюсы:

- быстрее для UI;
- меньше backend work.

Минусы:

- риск рассинхронизации player state and runtime state;
- сложнее объяснить authors why next action may jump back to runtime state;
- не подходит как надежная модель for server-authoritative games.

## 4. Минимальный безопасный следующий шаг

До архитектурного решения можно делать только neutral UI/workflow work:

1. показать chronology timeline more clearly;
2. add local trace list for editor-only events;
3. prove via tests that trace selection does not mutate `jsonText`, DocumentStore history or AI patch journal.

Настоящий restore preview state должен ждать согласованного варианта A/B/C.

## 5. Вопрос на согласование

Для следующего полноценного time-travel slice нужно выбрать один из вариантов:

- **A**: сначала editor-only trace UI, без настоящего runtime rollback;
- **B**: runtime-api preview snapshot restore API;
- **C**: player-web local snapshot restore через iframe bridge.

Рекомендуемый технический путь для server-authoritative games is **B**, but it requires a new contract and must be accepted before implementation.
