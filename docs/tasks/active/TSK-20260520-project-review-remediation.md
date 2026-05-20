# TSK-20260520-project-review-remediation: Project Review Remediation

## Оглавление

- [Status](#status)
- [Why](#why)
- [Scope](#scope)
- [Terms](#terms)
- [Requirements](#requirements)
- [Plan](#plan)
- [Acceptance](#acceptance)
- [Validation](#validation)
- [Artifacts](#artifacts)
- [Handoff Log](#handoff-log)

## Status

review

## Why

Ревью `docs/reviews/2026-05-20-project-review.md` выявило несколько разрывов, которые мешают следующему агенту или разработчику безопасно продолжать работу: неполный `PROJECT_STRUCTURE.yaml`, невалидные `.desc.json`, рассинхрон legacy-реестров, устаревшие task notes по portal runtime binding, битые ссылки в документации и неполный canonical gate.

Эта задача нужна, чтобы перевести найденные проблемы в управляемый набор исправлений с проверяемой приемкой.

## Scope

Входит в работу:

- исправить структурный индекс и все невалидные `.desc.json`;
- синхронизировать `docs/legacy/debt-log.csv` и `docs/legacy/stubs-register.md`;
- добавить CI gate, который блокирует незарегистрированные заглушки;
- заменить PowerShell-only legacy validation на поддерживаемую cross-platform проверку или добавить равнозначный Node/Python wrapper;
- обновить устаревшие ссылки на несуществующие документы и файлы;
- синхронизировать portal launch TSK с фактической реализацией runtime binding;
- включить `player-web` тесты в canonical verification или явно разделить полный и быстрый gates;
- переформулировать `PROJECT_OVERVIEW.md`, чтобы current deterministic path не смешивался с historical LLM-first target.

Не входит в работу:

- реализация PostgreSQL-backed runtime session persistence;
- реализация completion event, архива one-time покупки и журнала завершенной игры;
- полная production-инфраструктура portal backend;
- переписывание Game Engine или Router target architecture.

## Terms

- CI - Continuous Integration, автоматическая проверка изменений перед слиянием.
- Stub - временная заглушка, то есть подмена или упрощение production-поведения.
- TSK - рабочая задача проекта в `docs/tasks/active/`.
- GSR - Gameplay Slice Record, запись с bounded gameplay details для конкретного среза миграции.

## Requirements

### CI Stub Gate

CI-проверка legacy/stub governance должна быть обязательной и блокирующей.

Минимальные правила:

1. Любая активная заглушка должна иметь строку в `docs/legacy/debt-log.csv`.
2. Любая активная строка `LEGACY-*`, которая описывает заглушку или неготовый scaffold, должна быть отражена в текущей таблице `docs/legacy/stubs-register.md`.
3. `docs/legacy/stubs-register.md` не должен ссылаться на несуществующий `LEGACY-*`.
4. Для каждой активной legacy-записи `stub_reference` должен существовать или должен быть явно помечен как intentional missing target с отдельным documented reason.
5. CI должен падать при невалидном CSV/Markdown registry pair, невалидном `.desc.json` и незарегистрированных stub markers в поддерживаемых source paths.
6. GitHub Actions workflow должен запускать gate на `pull_request`, `push` в protected branches и `merge_group`, если используется merge queue.
7. Branch protection или repository ruleset должны требовать успешный статус legacy/stub gate перед merge.

Требование опирается на текущую модель GitHub Actions: команда, завершившаяся non-zero exit code, делает job failed; required status checks в branch protection/ruleset блокируют merge, пока job не пройдет.

## Plan

### Phase 1. Structural Source Of Truth Repair

1. Исправить невалидные `.desc.json`:
   - `services/router/.desc.json`;
   - `services/game-repository/.desc.json`;
   - `apps/player-web/public/images/.desc.json`;
   - `services/game-engine/.desc.json`;
   - `draft/antarctica-nextjs-player/.desc.json`.
2. Сделать `scripts/dev/generate-structure.js` fail-fast при невалидном `.desc.json`.
3. Обновить `docs/tasks/active/.desc.json`, чтобы все активные TSK были видимы в `PROJECT_STRUCTURE.yaml`.
4. Запустить `node scripts/dev/generate-structure.js`.

### Phase 2. Legacy And Stub Registry Gate

1. Синхронизировать `docs/legacy/debt-log.csv` и `docs/legacy/stubs-register.md`.
2. Решить `LEGACY-0006`: либо создать/вернуть documented `SDK/extensions/`, либо заменить `stub_reference` на существующий архитектурный документ/ADR и явно описать intentional missing target.
3. Добавить cross-platform validator, предпочтительно `node scripts/ci/validate-legacy.js`, который проверяет:
   - валидность CSV;
   - отсутствие duplicate `LEGACY-*`;
   - registry-to-debt и debt-to-registry consistency для активных заглушек;
   - существование `stub_reference`;
   - отсутствие незарегистрированных `stub`, `mock`, `TODO`, `заглушка` markers в поддерживаемых source/docs paths, кроме allowlist.
4. Оставить `validate-legacy.ps1` как wrapper или исторический файл, но текущий CI должен использовать cross-platform validator.
5. Добавить или обновить CI workflow так, чтобы legacy/stub gate был отдельным required check.

### Phase 3. Documentation Truth Repair

1. Убрать или заменить ссылки на отсутствующие:
   - `services/runtime-api/HANDOFF.md`;
   - `GSR-030`;
   - `CONTRACT_INDEX.md`;
   - `apps/player-web/src/lib/antarctica.ts`;
   - `apps/player-web/src/components/antarctica-s1-renderer.test.tsx`.
2. Обновить `docs/tasks/active/TSK-20260518-portal-test-vps-and-antarctica-launch.md`:
   - убрать утверждения, что runtime binding отсутствует;
   - оставить реальные gaps: e2e/integration portal-player-runtime, completion event, archive/journal, deploy/readiness.
3. Обновить `PROJECT_OVERVIEW.md`:
   - явно разделить current canonical deterministic path и target/historical LLM-first architecture;
   - не описывать strict Ajv validation как завершенное current state, пока `strict: false` сохраняется.
4. Расширить `TSK-20260518-json-schema-strict-validation`, чтобы ручная `templateId` cross-validation была либо перенесена в JSON Schema, либо оформлена как documented exception.

### Phase 4. Verification Gate Cleanup

1. Добавить `npm test --workspace @cubica/player-web` в `verify:player-web`, либо ввести отдельный `verify:canonical:full` и ясно описать difference.
2. Обновить `README.md`, `NEXT_STEPS.md` и relevant TSK validation sections, чтобы они ссылались на фактические gates.
3. Подтвердить:
   - `npm run verify:canonical`;
   - `npm test --workspace @cubica/player-web`;
   - legacy/stub validator;
   - `node scripts/dev/generate-structure.js`.

## Acceptance

- `PROJECT_STRUCTURE.yaml` отображает все активные TSK из `docs/tasks/active/`.
- Все `.desc.json` парсятся стандартным `JSON.parse`.
- `scripts/dev/generate-structure.js` не скрывает ошибки `.desc.json`.
- `docs/legacy/debt-log.csv` и `docs/legacy/stubs-register.md` согласованы в обе стороны.
- CI legacy/stub gate падает на незарегистрированной заглушке и на активной legacy-записи без registry coverage.
- Для GitHub Actions documented required check покрывает `pull_request`, protected branch `push` и `merge_group`.
- Portal launch TSK больше не утверждает, что runtime binding отсутствует, если код уже содержит binding path.
- Битые ссылки из ревью 2026-05-20 исправлены или явно заменены на существующие документы.
- `verify:canonical` или documented full gate запускает `player-web` tests.

## Validation

```text
node -e "const fs=require('fs'); const cp=require('child_process'); for (const f of cp.execSync('rg --files -g .desc.json',{encoding:'utf8'}).trim().split(/\n/)) JSON.parse(fs.readFileSync(f,'utf8'));"
node scripts/dev/generate-structure.js
node scripts/ci/validate-legacy.js
npm run verify:canonical
npm test --workspace @cubica/player-web
npm run test:portal-rules --prefix services/portal-backend
rg -n "services/runtime-api/HANDOFF.md|GSR-030|CONTRACT_INDEX.md|src/lib/antarctica.ts|antarctica-s1-renderer" PROJECT_OVERVIEW.md docs/architecture/gameplay-slices apps/player-web
```

Expected failure proof:

```text
node scripts/ci/validate-legacy.js --self-test-unregistered-stub
```

The self-test command must fail with an unregistered stub marker message; that failure is the expected proof that the gate blocks new undocumented markers.

## Artifacts

- `docs/reviews/2026-05-20-project-review.md`
- `docs/tasks/artifacts/TSK-20260520-project-review-remediation/remediation-execution-matrix.md`

## Handoff Log

### 2026-05-20 - AI agent

- Created this planning and execution task from `docs/reviews/2026-05-20-project-review.md`.
- Added explicit CI stub gate requirement and implementation phases.
- Next safe step: implement Phase 1, then create the cross-platform legacy/stub validator before touching CI workflow requirements.

### 2026-05-20 - AI agent implementation

- Fixed invalid `.desc.json` files and changed `scripts/dev/generate-structure.js` to fail fast on invalid JSON.
- Added `scripts/ci/validate-legacy.js`, kept `validate-legacy.ps1` as a wrapper, added `verify:legacy`, and wired GitHub Actions jobs for legacy/stub gate, canonical verification and portal rule tests.
- Synchronized `docs/legacy/debt-log.csv` with `docs/legacy/stubs-register.md`, moved `LEGACY-0006` from missing `SDK/extensions/` to ADR-015, and documented the portal payment stub as `LEGACY-0013`.
- Added `docs/legacy/stub-marker-allowlist.json` for pre-existing marker exceptions with owner, reason and expiry.
- Updated broken active documentation references, portal launch validation notes, `PROJECT_OVERVIEW.md`, `apps/player-web/README.md`, and the JSON Schema strict validation task.
- Regenerated `PROJECT_STRUCTURE.yaml`.

### 2026-05-21 - AI agent e2e pass

- Added Playwright e2e tests for normal player boot/runtime action dispatch and portal launch binding.
- Added `npm run test:e2e`, root `playwright.config.ts`, e2e directory metadata and CI job `player-web e2e`.
