# Time-Travel Rollback Options

## Оглавление

- [1. Понимание вопроса](#1-понимание-вопроса)
- [2. Текущий факт](#2-текущий-факт)
- [3. Варианты](#3-варианты)
- [4. Принятое решение](#4-принятое-решение)
- [5. Реализационные правила](#5-реализационные-правила)

## 1. Понимание вопроса

Нужно продолжить preview-first editor без того, чтобы timeline rollback случайно стал историей изменений authoring JSON.

**Timeline rollback** здесь означает возврат состояния preview-сессии к выбранному событию прохождения. Это не undo документа, не Git rollback и не изменение манифеста.

## 2. Текущий факт

Уже есть:

- core-модель `PreviewPlaythroughTrace`, event log, snapshots and `buildPreviewTraceRestorePlan` in `packages/editor-engine`;
- timeline band в `apps/editor-web`, который показывает chronology из `root.logic.flows[].steps[]`;
- iframe bridge from `player-web` to `editor-web` for preview entity descriptors;
- runtime session creation and action dispatch through `runtime-api`.

Было не реализовано на момент выбора варианта:

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

**Статус: принято.** Preview в editor-web выполняет роль отладчика серверной игровой логики, поэтому runtime-api должен оставаться авторитетным владельцем состояния preview-сессии.

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

## 4. Принятое решение

Принят **Вариант B**:

- `runtime-api` получает preview-only restore endpoint для восстановления server-authoritative session state;
- endpoint доступен только для editor preview sessions, то есть сессий с временным `contentSourceId`;
- `player-web` отправляет в editor-web runtime snapshot-сообщения только в preview mode;
- `editor-web` ведет recorded playthrough trace из runtime snapshots и действий;
- при rollback editor-web просит runtime-api восстановить выбранный snapshot и перезагружает iframe preview на ту же runtime session;
- rollback не меняет authoring JSON, DocumentStore history, AI patch journal или Git history.

История прохождения не ветвится. Если автор откатился к событию `N` и продолжил играть, все события после `N` отбрасываются из editor trace, и дальше остается только новый линейный путь.

## 5. Реализационные правила

Минимальный safe implementation:

- runtime-api не импортирует `editor-engine` and does not know authoring JSON;
- player-web не хранит собственную authoritative rollback state; после restore он reload/resume-ит runtime session;
- editor trace хранит tooling-only snapshots and events and can later be persisted under `.tmp/editor-playthroughs/`;
- first implementation may capture a runtime snapshot for each runtime state version, so restore can target exact event sequences without replaying sparse events;
- sparse snapshot + replay optimization remains compatible with `PreviewTraceRestorePlan`, but is not required for the first browser slice.

Варианты A и C больше не рассматриваются для целевой модели server-authoritative games. Они могут использоваться только as temporary UI debugging aids, если это явно оформлено как tech debt.
