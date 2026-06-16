# TSK-20260616 Antarctica UI Authoring Prototype Execution Matrix

## Оглавление

- [Purpose](#purpose)
- [Invariants](#invariants)
- [Candidate Inventory](#candidate-inventory)
- [Execution Slices](#execution-slices)
- [Prototype Details](#prototype-details)
- [Validation Gates](#validation-gates)
- [Deferred Candidates](#deferred-candidates)
- [Handoff Checklist](#handoff-checklist)

## Purpose

Эта матрица переводит анализ `games/antarctica/authoring/ui/web.authoring.json` в маленькие implementation slices. Она нужна, чтобы исполнитель вводил прототипы последовательно, сразу удалял замененные копии и после каждого шага доказывал отсутствие runtime UI drift.

Runtime UI drift - нежелательное изменение `games/antarctica/ui/web/ui.manifest.json`, которое меняет то, что видит игрок, хотя задача должна менять только authoring-структуру.

## Invariants

| Invariant | Required Control |
| --- | --- |
| Прототипы остаются authoring-only. | Runtime leakage scan по `_definitions`, `_type`, `_extends`, `_promptTemplate`, `_prototypeImports`, `_source_trace`. |
| Runtime/player не знают о прототипах. | Нет изменений в `runtime-api`; generic `player-web` не получает ветки для `_definitions`. |
| Чистая миграция не меняет UI. | Canonical diff generated `ui.manifest.json` до и после каждого slice. |
| Source map остается навигируемым. | Проверить, что affected source-map pointers существуют в authoring JSON. |
| JSON Schema остается source of truth. | Использовать `npm run verify:manifest-authoring`, не писать ручные shape guards. |
| Platform promotion запрещен в этой задаче. | Все `_type` имена остаются локальными `ui.Antarctica*`. |
| Реальные UI сущности остаются в `root`. | `_definitions` содержит только reusable prototypes, не переносит реальные screens/panels. |

## Candidate Inventory

Baseline observations:

| Area | Count or Evidence | Decision |
| --- | ---: | --- |
| `_definitions` | 0 | Fill with local game-level prototypes. |
| `root.screens` | 4 | Do not change screen count in this task. |
| `root.panels` | 2 | Keep `history` and `hint` as panels. |
| `buttonComponent` | 23 | High priority leaf extraction. |
| `cardComponent` | 13 | High priority leaf extraction. |
| `gameVariableComponent` | 40 | High priority, but preserve metric-specific differences. |
| `areaComponent` | 45 | Extract only meaningful containers; reject css-only prototypes. |
| `richTextComponent` | 12 | Extract only repeated semantic text patterns. |

Baseline audit:

```bash
node scripts/manifest-tools/audit-prototype-candidates.cjs \
  --scope file \
  --file games/antarctica/authoring/ui/web.authoring.json \
  --format json \
  --min-repeat 2 \
  --min-fields 3
```

Top candidate groups to keep:

| Candidate | Source pointers | Slice |
| --- | --- | --- |
| Helper buttons | `btn-journal`, `btn-hint` across screens and panels | S1 |
| Nav buttons | `nav-left`, `nav-right` across screens and hint panel | S1 |
| Static request-server cards | `/root/screens/0/root/.../card-*`, `/root/screens/3/root/.../card-*` | S2 |
| Dynamic board card | `/root/screens/1/root/.../board-card` | S2 |
| Topbar metric badges | metric children under `S1`, `board-topbar`, `info-topbar`, `hint` | S3 |
| Screen root shell | `screenComponent` roots with arctic background | S4 |
| Default bottom controls | repeated four-button row on `S1`, `board-topbar`, `S1_LEFT` | S4 |
| Overlay panel shell | `history`, `hint` common panel fields | S4 |
| Journal entry side | front/back journal columns | S5 |

## Execution Slices

| Slice | Goal | Main Edit | Done When |
| --- | --- | --- | --- |
| S0. Baseline | Confirm current state and diff target. | No source edits. | Done: compile baseline passed and runtime UI snapshot was captured. |
| S1. Button prototypes | Extract helper and nav button leaves. | Add 3 definitions and replace button instances. | Done: show/close panel and nav button prototypes applied. |
| S2. Card prototypes | Extract static and dynamic card leaves. | Add request-server and board-choice card definitions. | Done: 12 static cards and the dynamic board card use local prototypes. |
| S3. Metric prototypes | Extract repeated topbar metrics. | Add base + metric-specific topbar definitions. | Done: 8 topbar metric prototypes applied to repeated topbar/hint instances. |
| S4. Container prototypes | Extract safe shells and rows. | Add root, bottom-controls, panel container definitions. | Done: screen root, overlay panel, panel button container, fallback text and default bottom controls applied. |
| S5. Journal internals | Extract journal entry side only if readable. | Add journal side definition. | Deferred: current array replacement makes a useful journal side prototype too indirect. |
| S6. Closeout | Final audit and handoff. | Update task log. | Done: validation evidence recorded in active task. |

## Prototype Details

### S1. Buttons

| Prototype `_type` | Common body | Instance overrides |
| --- | --- | --- |
| `ui.AntarcticaShowPanelButton` | `type: buttonComponent`, `props.variant: helper`, `actions.onClick.command: showPanel` | `id`, `_label`, `props.caption`, `actions.onClick.payload.panelId`. |
| `ui.AntarcticaClosePanelButton` | `type: buttonComponent`, `props.variant: helper`, `actions.onClick.command: closePanel` | `id`, `_label`, `props.caption`, `actions.onClick.payload.panelId`. |
| `ui.AntarcticaNavButton` | `type: buttonComponent`, `props.variant: nav` | `id`, `_label`, `props.caption`, optional `props.disabled`. |

Order:

1. Add definitions.
2. Replace the row in `S1`.
3. Compile.
4. Replace `board-topbar`, then compile.
5. Replace `info-topbar`, `S1_LEFT`, `history`, `hint`, compiling after each group.

### S2. Cards

| Prototype `_type` | Common body | Instance overrides |
| --- | --- | --- |
| `ui.AntarcticaRequestServerCard` | `type: cardComponent`, `actions.onClick.command: requestServer`, empty payload | `id`, `_label`, `props.text`. |
| `ui.AntarcticaBoardChoiceCard` | `type: cardComponent`, dynamic `title`, `summary`, `selectLabel`, `visualState`, `payload.cardId` | Usually only `id` and labels. |

Do not merge `S1` and `S1_LEFT` card text into one definition. Text is scenario/content data and must remain visible on the instance unless a separate screen normalization task moves it to game content.

### S3. Metrics

Recommended pattern:

1. Add `ui.AntarcticaTopbarMetricBadge` with only `type: gameVariableComponent`.
2. Add metric-specific prototypes:
   - `ui.AntarcticaTopbarScoreMetric`;
   - `ui.AntarcticaTopbarProMetric`;
   - `ui.AntarcticaTopbarRepMetric`;
   - `ui.AntarcticaTopbarLidMetric`;
   - `ui.AntarcticaTopbarManMetric`;
   - `ui.AntarcticaTopbarStatMetric`;
   - `ui.AntarcticaTopbarContMetric`;
   - `ui.AntarcticaTopbarConstrMetric`.
3. Use `_extends: "ui.AntarcticaTopbarMetricBadge"` for metric-specific definitions.
4. Keep `props.description` on instances where the exact text differs.

Do not use `root.metric_specs` as the source of truth in this task. It currently diverges from rendered metric components and needs a separate reconciliation if it becomes a real UI data source.

### S4. Containers And Shells

| Prototype `_type` | Allowed common body | Not allowed in first pass |
| --- | --- | --- |
| `ui.AntarcticaScreenRoot` | `type: screenComponent`, `props.backgroundImage` | Full `children[]` for screen roots. |
| `ui.AntarcticaDefaultBottomControls` | Full four-button row only for identical `S1`, `board-topbar`, `S1_LEFT` rows | `info-topbar`, because it has `btn-advance` and different order. |
| `ui.AntarcticaOverlayPanel` | `type: panel`, `mode: overlay`, `layout_mode: topbar` | Panel-specific title, design artifact and content. |
| `ui.AntarcticaPanelButtonContainer` | `type: areaComponent`, panel button css and two helper buttons | Panel-specific active button behavior must stay explicit through show/close button overrides. |

### S5. Journal Internals

Candidate:

| Prototype `_type` | Common body | Instance overrides |
| --- | --- | --- |
| `ui.AntarcticaJournalEntrySide` | `areaComponent` with two `richTextComponent` children: label and text | side css class, label html, text binding. |

Gate: apply only if the editor view remains readable. Journal UI is game-specific and should not be promoted.

## Validation Gates

Run after each slice:

```bash
npm run compile:manifests -- --game antarctica --check
npm run verify:manifest-authoring
git diff --check
```

Run after S3 and final closeout:

```bash
node scripts/manifest-tools/audit-prototype-candidates.cjs \
  --scope file \
  --file games/antarctica/authoring/ui/web.authoring.json \
  --format json \
  --min-repeat 2 \
  --min-fields 3
```

Runtime leakage scan:

```bash
rg -n '"_definitions"|"_type"|"_extends"|"_promptTemplate"|"_prototypeImports"|"_source_trace"' \
  games/*/game.manifest.json \
  games/*/ui/*/ui.manifest.json
```

Source-map pointer check:

```bash
node - <<'NODE'
const fs = require("fs");
const source = JSON.parse(fs.readFileSync("games/antarctica/authoring/ui/web.authoring.json", "utf8"));
const map = JSON.parse(fs.readFileSync("games/antarctica/ui/web/ui.manifest.source-map.json", "utf8"));
function readPointer(document, pointer) {
  if (pointer === "") return true;
  let current = document;
  for (const raw of pointer.slice(1).split("/")) {
    const segment = raw.replace(/~1/g, "/").replace(/~0/g, "~");
    if (current === null || typeof current !== "object" || !(segment in current)) return false;
    current = current[segment];
  }
  return true;
}
const missing = [];
for (const sources of Object.values(map.mappings || {})) {
  for (const entry of sources) {
    if (entry.file.endsWith("games/antarctica/authoring/ui/web.authoring.json") && !readPointer(source, entry.pointer)) {
      missing.push(entry.pointer);
    }
  }
}
if (missing.length > 0) {
  throw new Error(`Missing source-map pointers: ${missing.slice(0, 20).join(", ")}`);
}
NODE
```

## Deferred Candidates

| Candidate | Reason |
| --- | --- |
| `props.cssClass` only | Too small; should be absorbed into real component/container prototypes. |
| `actions.onClick.payload.panelId` only | Too small; belongs inside button prototypes. |
| Full screen prototypes | Current array merge behavior makes large `children[]` definitions brittle. |
| Left-sidebar metrics | Only one current screen uses them; keep explicit until another repeated source appears. |
| Platform-level `ui.PanelButton` | Needs evidence from another game/channel before promotion. |
| `root.metric_specs` reconciliation | Separate task; current specs diverge from actual rendered metric components. |
| Residual deterministic audit candidates after extraction | Current scanner still reports small repeated `props` and inherited-instance fragments; handle through smarter grouping or suppression, not by over-extracting. |

## Handoff Checklist

Before stopping implementation, update:

- active task `Handoff Log`;
- slice statuses in this matrix if a slice was started;
- changed files;
- validation commands and results;
- audit summary before/after;
- remaining candidates and rejected over-extraction cases;
- next safe step.
