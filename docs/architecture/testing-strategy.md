# Testing Strategy

Документ описывает политику тестирования Cubica и целевую архитектуру проверок для текущего **canonical slice** (канонического среза, то есть обязательного проверяемого набора сервисов, приложений и игровых данных) и следующих этапов платформы.

## Оглавление

- [1. Как понята задача](#1-как-понята-задача)
- [2. Контекст проекта](#2-контекст-проекта)
- [3. Принципы](#3-принципы)
- [4. Уровни тестирования](#4-уровни-тестирования)
- [5. Политика по подсистемам](#5-политика-по-подсистемам)
- [6. Архитектура тестового контура](#6-архитектура-тестового-контура)
- [7. Варианты архитектуры](#7-варианты-архитектуры)
- [8. Рекомендуемый вариант](#8-рекомендуемый-вариант)
- [9. CI-гейты](#9-ci-гейты)
- [10. Данные, фикстуры и временные файлы](#10-данные-фикстуры-и-временные-файлы)
- [11. LLM и недетерминированное поведение](#11-llm-и-недетерминированное-поведение)
- [12. Критерии качества тестов](#12-критерии-качества-тестов)
- [13. Источники лучших практик](#13-источники-лучших-практик)

## 1. Как понята задача

Нужно определить проектную политику тестирования и предложить архитектурные варианты, которые подходят Cubica как платформе бизнес-игр. Решение должно учитывать текущий стек: `node:test` для `runtime-api`, Vitest для frontend/editor packages, Playwright для браузерных сценариев, JSON Schema как **source of truth** (единственный авторитетный источник правил структуры данных) для манифестов и будущий LLM-слой.

## 2. Контекст проекта

Текущий canonical slice:

- `services/runtime-api` владеет runtime API, загрузкой content и player-facing DTO.
- `apps/player-web` рендерит игры через runtime/player boundary.
- `packages/editor-engine` и `apps/editor-web` отвечают за authoring editor.
- `packages/contracts/*` и `docs/architecture/schemas/*` задают контрактный слой.
- `games/antarctica` и `games/simple-choice` являются обязательными проверочными играми: первая покрывает сложный сценарий, вторая защищает game-agnostic path.

Термины:

- **CI** (continuous integration, автоматическая проверка изменений перед слиянием) должен блокировать нарушения архитектурных инвариантов.
- **E2E** (end-to-end, проверка пользовательского сценария через реальные сервисы и браузер) должен подтверждать только критичные сквозные пути, а не заменять unit-тесты.
- **Фикстура** (стабильный тестовый набор данных) должна быть достаточно маленькой для отладки и достаточно выразительной для проверки контракта.
- **Smoke-тест** (короткая проверка жизнеспособности) подтверждает, что основной путь запускается, но не доказывает полноту поведения.
- **Test runner** (запускатель тестов, программа, которая находит и выполняет тесты) выбирается по зоне ответственности пакета.
- **DTO** (Data Transfer Object, объект передачи данных между слоями) проверяется как публичный контракт, а не как внутренняя структура реализации.
- **Mock** (замена внешней зависимости контролируемой тестовой реализацией) допустим для внешних сетей, LLM и платежей, но не должен скрывать ошибки собственных контрактов.
- **Stub** (временная упрощенная реализация, которая имитирует будущий компонент) должен попадать в реестр заглушек, если влияет на поведение продукта.
- **Boundary** (граница взаимодействия между слоями) проверяется через публичный API или контракт, а не через внутренние детали модуля.
- **Replay** (повтор записанного сценария с фиксированными входами и ответами) нужен для gameplay и LLM-проверок.
- **Eval** (оценочный тест качества поведения) проверяет соответствие ответа правилам игры и ожидаемому смыслу.
- **Coverage** (покрытие кода тестами) используется как вспомогательная метрика, а не как главный показатель качества.

## 3. Принципы

1. **Риск важнее процента покрытия.** Блокирующие проверки должны защищать контракты, деньги, запуск сессий, сохранность прогресса, authoring source of truth и game-agnostic runtime.
2. **Контракты проверяются раньше интерфейса.** JSON Schema, компиляция authoring manifests и contract fixtures должны падать до браузерного E2E.
3. **Тесты повторяют поведение пользователя.** UI-тесты должны опираться на доступные роли, текст и публичные состояния, а не на внутренние CSS-классы.
4. **Недетерминированное не входит в быстрый PR-гейт.** Live LLM, реальные платежи и внешние сети проверяются отдельно: replay, моки провайдера, тестовый контур или ночной запуск.
5. **Новые механики получают проверку на своем уровне.** Общая механика проверяется в schema/contract/runtime tests; game-specific механика остается в game bundle или plugin tests.
6. **Тестовые заглушки документируются.** Любой временный mock или stub, который влияет на поведение платформы, должен быть зарегистрирован в legacy/stub governance.
7. **E2E должен быть малым и надежным.** Браузерные проверки дороже и хрупче unit/integration tests, поэтому они покрывают ключевые сквозные сценарии и используют trace/video только для расследования падений.

## 4. Уровни тестирования

| Уровень | Назначение | Инструменты | Где жить |
|---|---|---|---|
| Static checks | Типы, структура, дрейф generated files, архитектурные инварианты | `tsc`, `scripts/ci/*`, schema validation | root scripts, package scripts |
| Unit | Чистая логика без сети и браузера | `node:test`, Vitest | рядом с кодом или `tests/` пакета |
| Contract | Совместимость DTO, схем и manifest formats | Ajv, schema fixtures, compiler checks | `docs/architecture/schemas`, `games/*`, `scripts/ci/*` |
| Integration | Несколько модулей через публичную границу | `node:test`, Vitest, in-memory adapters | `services/*/tests`, package tests |
| Component | Поведение React-компонентов в DOM-среде | Vitest + Testing Library | `apps/*/src/**/*.test.tsx` |
| E2E | Пользовательские сценарии через сервисы и браузер | Playwright | `apps/*/e2e/*.spec.ts` |
| Visual | Регрессии верстки и плотных UI-состояний | Playwright screenshots, pixel diff, later visual tool | отдельные smoke/e2e сценарии |
| Performance | Время ответа, деградации editor/player/runtime | targeted scripts, later load tests | nightly/release contour |
| LLM eval | Качество и стабильность LLM-поведения | replay traces, semantic evaluators | отдельный eval contour |

## 5. Политика по подсистемам

### Runtime API

- Unit-тесты покрывают deterministic handlers, JsonLogic, шаблоны действий и pure validation helpers.
- Integration-тесты покрывают HTTP boundary: health/readiness, создание сессии, dispatch action, player-facing content, ошибки запроса.
- Для каждого нового runtime capability нужна минимум одна game-agnostic фикстура, не привязанная к `Antarctica`.
- Ручные TypeScript-проверки структуры манифеста не должны заменять JSON Schema + Ajv.

### Contracts и schemas

- JSON Schema остается source of truth для runtime/authoring manifests.
- Любое новое поле схемы требует позитивного и негативного schema fixture или теста.
- Generated runtime manifests проверяются на drift через `verify:manifest-authoring`.
- Cross-reference checks допустимы как отдельный validation layer, если JSON Schema не может выразить ссылочную целостность, но это должно быть явно задокументировано.

### Player Web

- Component tests проверяют rendering, доступность действий, состояние кнопок, fallback sessions и presenter behavior.
- E2E проверяет загрузку game session, выполнение действия, продолжение сессии и portal launch binding.
- Селекторы в браузере должны идти через role/text/test id только там, где role/text недостаточно стабильны.
- Game-specific UI проверяется в plugin tests, generic player не должен получать hardcoded game branches.

### Editor Engine и Editor Web

- `packages/editor-engine` проверяется как framework-agnostic ядро: JSON Pointer, JSON Patch, projection, diagnostics, source maps, preview descriptors.
- `apps/editor-web` проверяет repository/session adapters, route handlers, preview bridge, undo/redo и UI panels.
- Browser E2E остается обязательным для workflow "open session -> edit -> validate/compile -> preview".
- Все временные worktrees и screenshots должны жить в `.tmp/`.

### Portal и launch sessions

- Launch rules тестируются как pure functions без Strapi boot, чтобы правила срока действия и binding были быстрыми и надежными.
- Интеграционные тесты должны покрывать создание покупки, token resolution, expiration, one-time/day/month/multiplayer binding и admin access.
- E2E должен подтверждать путь "консультант получил ссылку -> игрок открыл player -> runtime session связана правильно".

### Game content

- Каждая игра должна иметь smoke path: session start, первый action, terminal или стабильная intermediate checkpoint state.
- Сложные gameplay-slices проверяются replay-сценариями: входное состояние, action, ожидаемый state patch/player-facing result.
- Game-specific детали фиксируются в Gameplay Slice Records, а не в platform runtime code.

## 6. Архитектура тестового контура

Целевой контур состоит из четырех слоев:

1. **Package-local tests.** Каждый workspace владеет быстрыми тестами своего кода и не требует запуска всего монорепозитория.
2. **Contract governance.** Root scripts проверяют schemas, authoring compile drift, game-agnostic rules, legacy/stub registers и project structure.
3. **Scenario harness.** Общий набор фикстур и replay helpers запускает runtime/player/editor сценарии без live external providers.
4. **Browser acceptance.** Playwright поднимает runtime-api, player-web и editor-web для нескольких критичных user flows.

Тестовый контур должен сохранять текущую технологическую совместимость:

- `node:test` остается допустимым для backend services, где уже есть ESM/TypeScript запуск через `--experimental-strip-types`.
- Vitest остается основным runner для UI и framework-agnostic TypeScript packages.
- Playwright остается единственным браузерным E2E runner на root level.
- Ajv остается стандартным JSON Schema validator для manifest contracts.

## 7. Варианты архитектуры

### Вариант A. Минимальное укрепление текущей схемы

Сохранить текущие инструменты и добавить только недостающие scripts, coverage reports и несколько обязательных фикстур.

Плюсы:

- минимальный риск миграции;
- быстро внедряется;
- не ломает существующие package scripts.

Минусы:

- тестовая политика остается размазанной между пакетами;
- сложнее строить единые отчеты;
- LLM/replay и portal integration придется добавлять отдельно.

### Вариант B. Единая Vitest workspace-архитектура

Перевести почти все TypeScript tests на Vitest projects, а `node:test` оставить только для простых JS/Strapi helpers или убрать полностью.

Плюсы:

- единые reporters, coverage и watch mode;
- проще разделять node/happy-dom/browser projects;
- лучше подходит frontend/editor packages.

Минусы:

- миграция `runtime-api` может отвлечь от текущих архитектурных задач;
- есть риск смешать backend integration и frontend component concerns;
- потребуется аккуратная настройка ESM/TypeScript и package boundaries.

### Вариант C. Полноценная quality platform поверх текущих runners

Оставить package-local runners, но добавить общий policy layer: root `verify:*` scripts, shared fixtures, replay harness, contract governance, отчетность и release/nightly contours.

Плюсы:

- сохраняет уже работающие инструменты;
- лучше защищает архитектурные границы;
- позволяет отдельно развивать LLM eval, visual regression и performance;
- масштабируется на новые игры и каналы без обязательной миграции всех тестов.

Минусы:

- больше проектной дисциплины;
- нужен явный владелец shared fixtures и тестовой отчетности;
- возможно появление нового `packages/testing` позже, если helpers начнут дублироваться.

### Вариант D. E2E-first

Основной контроль делать через Playwright и тестовый стенд, а unit/contract tests оставить минимальными.

Плюсы:

- хорошо демонстрирует пользовательские сценарии;
- удобно для test VPS launch.

Минусы:

- медленно и дорого;
- хрупко при UI-изменениях;
- поздно ловит schema/contract drift;
- не подходит как основной guard для manifest/runtime архитектуры.

## 8. Рекомендуемый вариант

Рекомендуется **вариант C: policy layer поверх текущих runners**.

Архитектурное решение:

- сохранить `node:test`, Vitest и Playwright по текущим зонам ответственности;
- ввести единую классификацию тестов и обязательные gates по риску;
- усилить contract-first проверки для schemas/manifests;
- добавить replay-подход для gameplay и будущего LLM;
- не делать глобальную миграцию runner-ов до появления явной боли в сопровождении.

Целевое правило выбора теста:

1. Если поведение можно проверить pure unit test, не поднимать браузер или сервер.
2. Если проверяется boundary между слоями, использовать integration или contract test.
3. Если проверяется пользовательская задача, использовать Playwright.
4. Если проверяется визуальная точность, добавлять screenshot/pixel check только для стабильных, важных экранов.
5. Если поведение зависит от LLM или внешней сети, использовать replay/mock в PR и live eval вне PR-гейта.

## 9. CI-гейты

### Быстрый PR-гейт

Обязательный набор для обычного изменения:

```bash
npm run verify:legacy
npm run verify:manifest-authoring
npm run verify:game-agnostic
npm run verify:runtime-api
npm run verify:player-web
```

Для editor changes:

```bash
npm run verify:editor-engine
npm test --workspace @cubica/editor-web
npm run verify:editor-web
```

Для portal launch changes:

```bash
npm run test:portal-rules --prefix services/portal-backend
npm run test:e2e
```

### Merge/release-гейт

- Все быстрые PR-гейты.
- `npm run test:e2e` в чистом окружении без reuse existing servers.
- Browser traces, screenshots и videos сохраняются только при падении.
- Coverage reports собираются для affected packages и сравниваются с baseline.

### Nightly-гейт

- Расширенный Playwright набор.
- Replay gameplay scenarios для всех published fixtures.
- LLM eval/replay без live provider в PR и с live provider только в контролируемом бюджете.
- Performance smoke для runtime session action и editor preview compile.

## 10. Данные, фикстуры и временные файлы

- Canonical fixtures: `games/antarctica` и `games/simple-choice`.
- Новые platform features должны добавлять минимальную synthetic game fixture, если `simple-choice` уже не покрывает поведение.
- Тесты не должны писать в repository root.
- Все временные worktrees, screenshots, HAR-файлы и логи должны жить в `.tmp/`.
- E2E обязан убирать свои временные артефакты или оставлять их только как failure evidence.
- Generated manifests нельзя редактировать вручную; тесты должны проверять drift через compiler/check scripts.

## 11. LLM и недетерминированное поведение

Будущий LLM runtime/authoring слой нельзя проверять обычными exact-string assertions.

Политика:

- **Replay first.** В PR-гейте используются записанные provider responses или provider-neutral fixtures.
- **Semantic assertions.** Проверяется структура ответа, допустимость action, safety constraints и изменение state, а не дословный текст.
- **Golden traces.** Для ключевых сценариев хранится последовательность входов, ответов и ожидаемых state transitions.
- **Live eval отдельно.** Запуски с реальным LLM provider идут по расписанию или перед релизом, с лимитом бюджета и отчетом о drift.
- **Prompt changes require eval evidence.** Изменение системного prompt или tool contract требует обновленного replay/eval результата.

Для LLM eval всегда должен хранить критерий оценки: какие правила игры, ограничения безопасности или semantic expectations проверяются.

## 12. Критерии качества тестов

Хороший тест:

- падает по понятной причине;
- проверяет публичное поведение или явный контракт;
- не зависит от порядка запуска других тестов;
- использует минимальный mock;
- имеет название, описывающее business/runtime behavior;
- добавляет фикстуру только тогда, когда она защищает новый риск.

Плохой тест:

- повторяет реализацию;
- проверяет private helper без риска;
- зависит от CSS layout без визуального контракта;
- делает live network call в PR;
- требует `Antarctica` branch в generic runtime/player code;
- фиксирует generated artifact вместо authoring source.

Coverage policy:

- Не вводить единый высокий threshold для всего монорепозитория сразу.
- Для pure packages можно вводить локальный **ratchet** (порог, который можно только повышать или удерживать): новый код не должен снижать coverage по затронутому пакету.
- Coverage не заменяет обязательные contract/e2e checks.

## 13. Источники лучших практик

- Playwright Best Practices: user-visible behavior, test isolation, locators and web-first assertions — <https://playwright.dev/docs/best-practices>
- Playwright Locators: role/text/test id locator strategy — <https://playwright.dev/docs/locators>
- Vitest projects/environments/coverage docs — <https://vitest.dev/guide/>
- Testing Library Queries and guiding principles — <https://testing-library.com/docs/queries/about/>
- Next.js Testing guide — <https://nextjs.org/docs/app/guides/testing>
- Node.js test runner — <https://nodejs.org/api/test.html>
- Ajv JSON Schema validator docs — <https://ajv.js.org/guide/getting-started>
