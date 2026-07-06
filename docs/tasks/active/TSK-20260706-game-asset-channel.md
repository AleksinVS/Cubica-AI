# TSK-20260706-game-asset-channel: Платформенный канал игровых ассетов (ADR-063)

## Оглавление

- [Status](#status)
- [Understanding](#understanding)
- [Architecture Source](#architecture-source)
- [Why](#why)
- [Target State](#target-state)
- [Scope](#scope)
- [Non-Goals](#non-goals)
- [Dependencies](#dependencies)
- [Execution Plan](#execution-plan)
- [Acceptance](#acceptance)
- [Validation](#validation)
- [Risks](#risks)
- [Handoff Log](#handoff-log)

## Status

- Состояние: ready (ADR-063 принят 2026-07-06)
- Владелец: оркестратор (промт — `docs/tasks/artifacts/TSK-20260706-game-asset-channel/orchestrator-prompt.md`)
- Создана: 2026-07-06

## Understanding

Дать играм платформенный канал собственных статических изображений:
декларативный реестр `games/<id>/assets/assets.json` (новая JSON Schema),
контент-адресуемая раздача через runtime-api (индекс + файлы, по образцу
published-бандлов плагинов), резолвер по id для Phaser-сцен
(`PhaserSceneContext.assets`) и форма `asset:<id>` в image-свойствах
UI-манифестов, CI-валидатор с санитизацией SVG. Платформа не знает
конкретных игр; существующее размещение картинок «Антарктиды» в
`apps/player-web/public/` оформлено долгом LEGACY-0023 и мигрируется
отдельной задачей.

## Architecture Source

- ADR-063 (`docs/architecture/adrs/063-game-asset-channel.md`) — решение.
- `docs/architecture/game-asset-channel-design.md` — **нормативный дизайн**:
  §3 — справочник (схема, эндпоинты, заголовки, резолвер, `asset:`,
  валидатор), §4 — безопасность, §5 — тесты, §6 — закрытые решения,
  §7 — правила исполнителя, §8 — координация.
- Прецедент раздачи: `/published-plugin-bundles/...` в
  `services/runtime-api/src/modules/player-api/httpServer.ts` и
  `modules/content/localFileRepository.ts`.
- `docs/architecture/flow-simulation-platform-design.md` §4.0 — владелец
  контракта `PhaserSceneContext` (аддитивное расширение по правилу §3.3
  дизайна ассетов).

## Why

Первая игра-потребитель (`rail-tycoon-mini`) требует спрайтов; текущий
способ (файлы игр в `apps/player-web/public/`) — дрейф чистоты
(правило 10). Канал делает ассеты агенто-писаемыми (SVG как текст) с
проверяемой безопасностью, происхождением и иммутабельным кэшированием.

## Target State

Схема + контракты + валидатор в `verify:canonical`; эндпоинты индекса и
файлов зелёные по тестам §5 дизайна; `GameAssetResolver` в plugin-api и
поле `assets` в `PhaserSceneContext`; резолюция `asset:` в рендерере;
LEGACY-0023 зарегистрирован; документация синхронна.

## Scope

- `docs/architecture/schemas/game-assets.schema.json` + генерация
  контрактов + фикстуры.
- `scripts/ci/validate-game-assets.js` + подключение в `verify:canonical`.
- `services/runtime-api/src/modules/content/` (чтение реестра/файлов,
  кэш хэшей) и `modules/player-api/httpServer.ts` (два маршрута).
- `apps/player-web`: загрузка индекса, `GameAssetResolver` (plugin-api),
  инъекция в `PhaserSceneContext`, резолюция `asset:` в рендерере.
- Тесты всех слоёв по §5 дизайна.

## Non-Goals

- Миграция картинок «Антарктиды» (LEGACY-0023 — отдельная задача).
- Аудио и любые `kind`, кроме `image`; загрузка ассетов через редактор;
  CDN/внешние хранилища; оптимизация изображений.
- Ассеты конкретных игр (их создают TSK игр; здесь — только синтетические
  тестовые фикстуры).

## Dependencies

| # | Блок | Откуда | Нужен для |
|---|---|---|---|
| D1 | Phaser-хост и `PhaserSceneContext` в plugin-api | Phase 3 трека `TSK-20260706-flow-simulation-platform-capabilities` | Phase 3 (инъекция `assets` в контекст сцены) |

Phases 1–2 и резолюция `asset:` в рендерере от D1 не зависят.

## Execution Plan

### Phase 0. Принятие ADR и подготовка

- [ ] Убедиться, что ADR-063 переведён в Accepted (запуск промта
      оркестратора = принятие владельцем), `PROJECT_ARCHITECTURE.md` и
      `NEXT_STEPS.md` синхронизированы; расхождение — починить до кода.
- [ ] Проверить, что LEGACY-0023 присутствует в `docs/legacy/debt-log.csv`.
- [ ] Прочитать Architecture Source полностью; сверить `git log` по
      `httpServer.ts` (параллельный трек ADR-059 может его менять).

### Phase 1. Схема, контракты, CI-валидатор

- [ ] `game-assets.schema.json` по §3.1 дизайна; `npm run
      generate:contracts`; позитивные и негативные фикстуры (§5).
- [ ] `scripts/ci/validate-game-assets.js` по §3.5 (все правила, включая
      санитизацию SVG); подключить в `verify:canonical`; юнит-фикстуры на
      каждое правило.

### Phase 2. Раздача в runtime-api

- [ ] Чтение реестра и файлов в `modules/content/` (path safety по образцу
      published-бандлов), кэш SHA-256 по mtime.
- [ ] Маршруты `GET /game-assets/{gameId}/index.json` и
      `GET /game-assets/{gameId}/{assetId}/{sha256}.{ext}` по §3.2 (полный
      набор заголовков; все случаи 404).
- [ ] Unit-тесты по §5 (включая path traversal и заголовки).

### Phase 3. Клиентская сторона (player-web)

- [ ] Загрузка индекса (один раз на игру), `GameAssetResolver` в
      plugin-api; пустой резолвер для игр без ассетов и при ошибке сети.
- [ ] Расширение `PhaserSceneContext` полем `assets` — ТОЛЬКО по правилу
      координации §3.3 дизайна (Handoff Log обоих треков до правки; правка
      §4.0 flow-дизайна синхронно с кодом). Требует D1.
- [ ] Резолюция `asset:<id>` в image-свойствах рендерера (game-agnostic,
      ADR-055); предупреждение на неизвестный id.
- [ ] Vitest-тесты по §5.

### Phase 4. Closeout

- [ ] Полный прогон Validation; `verify:game-agnostic` зелёный.
- [ ] Документация: `PROJECT_ARCHITECTURE.md` (ADR-063 Accepted),
      `PROJECT_OVERVIEW.md` (если перечисляет возможности), Handoff Log;
      `generate-structure.js`; незакрытых субагентов нет; `.tmp/` чист.
- [ ] Уведомить (Handoff Log) TSK игры `rail-tycoon-mini` о готовности D4.

## Acceptance

- [ ] Фикстуры схемы (позитив/негатив) зелёные; parity контрактов зелёный.
- [ ] Валидатор ловит каждое правило §3.5 (красная фикстура на правило) и
      зелёный на эталонном каталоге; включён в `verify:canonical`.
- [ ] Эндпоинты: корректная отдача при верном хэше; 404 на всех негативных
      случаях §3.2; полный набор заголовков (включая CSP для svg) покрыт
      тестами.
- [ ] Резолвер и `asset:` работают по тестам §5; игра без ассетов и обрыв
      сети не ломают приложение (fail closed).
- [ ] В платформенном коде нет id конкретных игр/ассетов.
- [ ] LEGACY-0023 зарегистрирован; документация синхронна.

## Validation

```bash
npm run generate:contracts && npm run verify:contracts-schema-parity
npm run verify:canonical            # включает новый validate-game-assets
cd services/runtime-api && npm run typecheck && npm test
cd apps/player-web && npm run typecheck && npm test
node scripts/dev/generate-structure.js && git diff --exit-code PROJECT_STRUCTURE.yaml
```

## Risks

| Риск | Митигация |
|---|---|
| Конфликт правок `httpServer.ts` с треком ADR-059 | `git log` + Handoff Log обоих треков перед срезом; маленькие срезы |
| Расширение `PhaserSceneContext` разъедется с flow-треком | Только аддитивное поле; правило координации §3.3 (Handoff Log до правки; §4.0 обновляется синхронно) |
| Неполная санитизация SVG | Закрытый нормативный список правил §3.5 + два внешних рубежа (§4 п.2: заголовки, контексты без исполнения); новые правила — только через обновление дизайна |
| Валидатор замедлит verify:canonical | Только каталоги `games/*/assets/`; лимиты малы (≤ 4 МБ/игра) |
| Слабый исполнитель «дорисует» форматы/поля | Полные формы в §3 дизайна; правило «не изобретать» §7 |

## Handoff Log

- 2026-07-06 — задача создана вместе с ADR-063 и нормативным дизайном
  `docs/architecture/game-asset-channel-design.md`; LEGACY-0023 внесён в
  debt-log; статус planned; кода нет. Первый потребитель —
  `TSK-20260706-rail-tycoon-mini-game` (её зависимость D4).
- 2026-07-06 (позже) — ADR-063 принят владельцем проекта (Accepted
  2026-07-06); статус ready. Реализация не начата.
