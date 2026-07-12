# ADR-038: Testing Architecture And Policy

- **Дата**: 2026-05-29
- **Статус**: Proposed
- **Авторы**: Codex
- **Компоненты**: repository verification, `services/runtime-api`, `apps/player-web`, `apps/editor-web`, `packages/editor-engine`, `packages/contracts/*`, `games/*`, portal launch boundary

## Контекст

Вопрос понят так: проекту нужна единая политика тестирования и архитектурный выбор, как развивать тесты без нарушения текущих границ Cubica. Нужно учесть текущий **canonical slice** (канонический срез, то есть обязательный проверяемый набор сервисов, приложений и игровых данных), где runtime/player/editor уже имеют разные **test runners** (запускатели тестов), а JSON Schema остается **source of truth** (единственным авторитетным источником правил структуры данных) для манифестов.

Сейчас в репозитории уже есть несколько проверочных контуров:

- `services/runtime-api` использует `node:test` для unit/integration tests.
- `apps/player-web`, `apps/editor-web` и `packages/editor-engine` используют Vitest.
- Root `playwright.config.ts` поднимает `runtime-api`, `player-web` и `editor-web` для browser E2E.
- Root scripts проверяют legacy/stub governance, authoring manifest drift и game-agnostic invariants.
- `games/antarctica` и `games/simple-choice` уже играют роль canonical fixtures.

Ограничения:

- Нельзя заменить declarative JSON Schema imperatively coded validators.
- Generic runtime/player layers не должны получать game-specific branches.
- Live LLM behavior не должен быть обязательным быстрым PR-гейтом из-за недетерминированности, стоимости и зависимости от внешней сети.
- E2E не должен становиться заменой contract/unit tests.
- Replay означает повтор записанного сценария с фиксированными входами и ответами; eval означает оценочный тест качества поведения, а не только проверку отсутствия ошибки выполнения.

## Альтернативы

- **Минимальное укрепление текущей схемы** — оставить все как есть и добавить недостающие scripts/fixtures. Это быстро, но оставляет тестовую политику фрагментированной.
- **Единая Vitest workspace-архитектура** — перевести почти все TypeScript tests на Vitest projects. Это упрощает reporters/coverage, но несет миграционный риск для `runtime-api` и отвлекает от текущих архитектурных задач.
- **Policy layer поверх текущих runners** — добавить слой правил, который определяет обязательные проверки, сохранить `node:test`, Vitest и Playwright по зонам ответственности, но ввести единую классификацию тестов, contract governance (контроль соблюдения контрактов), shared fixtures и replay/eval контур. Это дает порядок без массовой миграции.
- **E2E-first** — проверять платформу преимущественно через Playwright и test VPS. Это полезно для демонстрации пользовательских сценариев, но медленно, поздно ловит schema drift и плохо подходит как основной guard.

## Решение

Выбранный целевой подход: **policy layer поверх текущих runners**.

Архитектурные инварианты:

- `node:test` остается допустимым backend runner для `runtime-api` и pure backend helpers.
- Vitest остается основным runner для framework-agnostic TypeScript packages и React component tests.
- Playwright остается browser E2E runner для критичных пользовательских сценариев.
- Ajv + JSON Schema остаются contract validation foundation для manifests.
- Root verification scripts являются governance layer и блокируют architecture drift раньше E2E.
- Gameplay behavior проверяется через manifest validation, deterministic runtime tests и replay fixtures.
- LLM behavior проверяется через replay/golden traces в PR и live eval только вне быстрого PR-гейта.
- Канонический отпечаток replay по принятому ADR-078 (версионированный стабильный SHA-256-хеш результата повторного
  выполнения) строится по игровому состоянию с рекурсивной сортировкой ключей.
  Из него исключаются только `public.log[*].at` и `runtime.lastUpdatedAt` —
  служебные отметки реального времени. Они остаются в сохранённом состоянии и
  журнале ведущего; все остальные поля, включая одноимённые поля вне этих двух
  путей, участвуют в сравнении.

Обязательная классификация тестов:

- static/governance checks;
- unit tests;
- contract tests;
- integration tests;
- component tests;
- browser E2E tests;
- visual checks where UI fidelity is a release risk;
- replay/eval tests for gameplay and LLM behavior.

## Последствия

- Существующие package scripts сохраняют совместимость.
- Новые platform capabilities должны добавлять tests на минимально достаточном уровне, а не сразу расширять E2E.
- Game-specific checks должны жить в game/plugin fixtures, не в generic runtime/player branches.
- Для LLM-сценариев потребуется отдельный replay/eval storage and reporting policy.
- Coverage thresholds должны вводиться постепенно по package-level ratchet (порог, который можно только повышать или удерживать), а не как единый монорепозиторный процент.
- Политика детализируется в `docs/architecture/testing-strategy.md`.
- Канонизация не изменяет исходный снимок и не подменяет реальные часы
  искусственным игровым временем. Два повтора с одинаковыми решениями получают
  одинаковый отпечаток, но полный аудит по-прежнему показывает фактическое время.
- Исключение всех полей с именами `at` или `lastUpdatedAt` отклонено как слишком
  широкое: оно могло бы скрыть значимое игровое расхождение. Полностью
  детерминированные искусственные часы также отклонены, потому что ухудшают
  фактический журнал проведения.

## Связанные артефакты

- `docs/architecture/testing-strategy.md`
- `docs/architecture/PROJECT_ARCHITECTURE.md`
- `docs/architecture/adrs/024-bounded-manifest-driven-gameplay-mechanics.md`
- `docs/architecture/adrs/025-json-schema-as-ssot-for-manifest-validation.md`
- `docs/architecture/adrs/026-game-agnostic-plugin-architecture.md`
- `docs/architecture/adrs/030-semantic-prototype-manifests.md`
- `docs/architecture/adrs/031-lightweight-task-plan-and-handoff-system.md`
- `docs/architecture/adrs/037-project-local-plugins-and-marketplace-safe-evolution.md`
- `docs/architecture/adrs/078-canonical-replay-state-fingerprint.md`
