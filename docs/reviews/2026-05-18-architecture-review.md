# Архитектурное ревью Cubica, 2026-05-18

Я понял задачу как ревью текущего состояния проекта: найти разрывы между заявленной архитектурой, структурой репозитория, кодом и проверками, отдельно оценить структуру проекта и предложить улучшения.

## Оглавление

- [1. Краткий вывод](#1-краткий-вывод)
- [2. Источники и рамки проверки](#2-источники-и-рамки-проверки)
- [3. Критичные разрывы](#3-критичные-разрывы)
- [4. Существенные несоответствия](#4-существенные-несоответствия)
- [5. Анализ структуры проекта](#5-анализ-структуры-проекта)
- [6. Проверки](#6-проверки)
- [7. Рекомендации](#7-рекомендации)

## 1. Краткий вывод

Проект уже имеет понятное ядро: `games/antarctica`, `services/runtime-api`, `apps/player-web` и `packages/contracts/*`. Это хорошо согласуется с текущим каноническим срезом из `PROJECT_OVERVIEW.md` и `PROJECT_ARCHITECTURE.md`.

Главная проблема сейчас не в отсутствии архитектуры, а в рассинхронизации: документы описывают завершенный и стабильный canonical slice, но проверки этого среза не проходят. Есть разрывы в truth model, workspace-графе, валидации схем, структуре проекта и реестрах техдолга.

Термины:

- **SSOT**: single source of truth, единый источник истины.
- **DTO**: data transfer object, объект передачи данных между слоями.
- **ADR**: architecture decision record, документ с архитектурным решением.
- **CI**: continuous integration, автоматические проверки при изменениях.

## 2. Источники и рамки проверки

Проверялись:

- `AGENTS.md`;
- `PROJECT_OVERVIEW.md`;
- `PROJECT_STRUCTURE.yaml`;
- `docs/architecture/PROJECT_ARCHITECTURE.md`;
- `NEXT_STEPS.md`;
- `docs/legacy/debt-log.csv`;
- `docs/legacy/stubs-register.md`;
- `package.json` и package-файлы рабочих пакетов;
- код `services/runtime-api`, `apps/player-web`, `packages/contracts`, `SDK/viewers`.

Ограничение проверки: рабочее дерево на момент ревью уже было грязным, включая изменения в `AGENTS.md`, `package.json`, `games/antarctica/game.manifest.json`, `packages/contracts/manifest/src/index.ts`, `services/runtime-api/src/modules/runtime/deterministicHandlers.ts`, `apps/player-web/*` и ряд новых временных скриптов в корне. Поэтому выводы относятся к текущему состоянию рабочей директории, а не к чистому `main`.

Ключевые локальные доказательства:

- `services/runtime-api/src/modules/content/manifestValidation.ts:23`: Ajv запускается с `strict: false`.
- `services/runtime-api/src/modules/player-api/requestValidation.ts:6`: API body валидируется ручными `typeof`-проверками.
- `services/runtime-api/src/modules/content/localFileRepository.ts:10`: runtime читает `games/<gameId>/game.manifest.json` напрямую из файловой системы репозитория.
- `services/runtime-api/src/modules/session/inMemorySessionStore.ts:9`: состояние сессий хранится в памяти процесса.
- `services/runtime-api/src/modules/admin/health.ts:44`: readiness content check фактически не загружает контент.
- `SDK/viewers/web-base/package.json:28`: пакет зависит от `@cubica/shared`, которого нет среди workspace-пакетов.
- `package.json:6`: `SDK/viewers/web-base`, `services/router`, `apps/portal-nextjs` и `services/portal-backend` не входят в root workspaces.
- `PROJECT_STRUCTURE.yaml:35`: под `services` отображены только `portal-backend` и `runtime-api`, хотя в дереве есть и другие service scaffolds.

По правилу репозитория использован Context7:

- Next.js: актуальная рекомендация для монорепозиториев включает явную настройку `transpilePackages` для локальных пакетов.
- Ajv: актуальная рекомендация для JSON Schema в Node.js/TypeScript включает компиляцию схем и строгий режим.
- TypeScript: для нескольких пакетов рекомендуется использовать project references и инкрементальную проверку, чтобы явно фиксировать граф зависимостей.

## 3. Критичные разрывы

### 3.1. Канонический срез не проходит проверки

Документы говорят, что `runtime-api`, `player-web`, `packages/contracts/*` и `games/antarctica` уже являются рабочим vertical slice. Например, `NEXT_STEPS.md` фиксирует, что базовый переход завершен и оставшаяся работа относится к расширению.

Фактическое состояние:

- `npm run typecheck --workspace services/runtime-api` падает.
- `npm test --workspace services/runtime-api` падает: 54 из 71 теста проходят, 17 падают.
- `npm run typecheck --workspace @cubica/player-web` проходит.
- `npm test --workspace @cubica/player-web` падает: 93 из 97 тестов проходят, 4 падают.

Симптомы `runtime-api`: opening-flow ожидает переходы вида `opening.info.i7.advance`, но фактически получает `opening.card.3.advance`; дальше сценарий ломается и часть шагов возвращает HTTP 400. Это противоречит `NEXT_STEPS.md`, где opening-flow заявлен как покрытый до terminal `i21`.

Риск: архитектурная документация создает ложное ощущение завершенности. Следующие изменения будут строиться поверх неустойчивого среза.

### 3.2. JSON Schema заявлена как SSOT, но валидация ослаблена

В `PROJECT_OVERVIEW.md` указано, что `docs/architecture/schemas/game-manifest.schema.json` является SSOT, а backend использует Ajv для строгой декларативной проверки. В коде `services/runtime-api/src/modules/content/manifestValidation.ts` Ajv создается с `strict: false`.

Дополнительно там же есть ручная проверка `templateId` через `typeof` и обход объектов. Семантическая проверка ссылок полезна, но сейчас она живет рядом со схемой как отдельная императивная логика. Это усиливает риск расхождения схемы, типов и runtime-валидатора.

Риск: контракт манифеста может быть принят кодом, но не описан схемой, или наоборот. Это прямо затрагивает правило репозитория про запрет declarative vs imperative drift.

### 3.3. Workspace-граф неполный и частично сломан

Корневой `package.json` включает только `apps/player-web`, `SDK/core`, `SDK/shared`, `SDK/react-sdk`, `services/runtime-api` и `packages/contracts/*`.

При этом `SDK/viewers/web-base/package.json` существует, но не включен в workspaces. Его зависимости указывают на `@cubica/sdk-core` и `@cubica/shared`, хотя фактический пакет называется `@cubica/sdk-shared`. Это делает пакет непроверяемым и потенциально неустанавливаемым.

Похожие проблемы:

- `services/router` содержит TypeScript-файлы `sessionEvents.ts` и `sessionRecovery.ts`, но у сервиса нет `package.json` и он не участвует в проверках.
- `apps/portal-nextjs` и `services/portal-backend` имеют `package.json`, но явно являются draft/prototype и не участвуют в workspace.
- многие package scripts для `build`, `test`, `lint` намеренно завершаются `exit 1`.

Риск: часть кода выглядит как продуктовая, но не проверяется и не собирается общей командой.

## 4. Существенные несоответствия

### 4.1. Документы смешивают текущую и целевую архитектуру

`PROJECT_OVERVIEW.md` сначала фиксирует текущий deterministic runtime, но далее снова описывает LLM-first игровой слой, Router Service, Game Engine Service, Game Repository и отдельные сервисы как активную логическую архитектуру.

`PROJECT_ARCHITECTURE.md` честнее разделяет current canonical slice и target services, но тоже содержит устаревшие ссылки и формулировки. Например, раздел структуры ссылается на `PROJECT_STRUCTURE.md`, хотя канонический файл сейчас `PROJECT_STRUCTURE.yaml`.

Риск: новый разработчик или агент не поймет, где факт, где цель, а где исторический план.

### 4.2. Реестр заглушек не совпадает с реестром долга

`docs/legacy/debt-log.csv` содержит активные записи:

- `LEGACY-0001`: LLM mock;
- `LEGACY-0003`: `services/game-engine` не реализован;
- `LEGACY-0004`: Catalog/Editor/Repository/Metadata не реализованы;
- `LEGACY-0005`: `SDK/viewers` не реализован.

Но `docs/legacy/stubs-register.md` в текущих заглушках показывает только `LEGACY-0001`. Это нарушает правило, что временные решения должны быть зарегистрированы и иметь план снятия.

Отдельно: `LEGACY-0005` говорит, что `SDK/viewers` не реализован, но `SDK/viewers/web-base` уже существует как пакет. Значит статус устарел или пакет является только непроверенным каркасом.

### 4.3. Runtime все еще жестко завязан на файловую систему репозитория

`LocalFileGameRepository` строит путь к `games/<gameId>/game.manifest.json` через `repoRoot`. Это приемлемо для текущего bounded slice, но остается production-разрывом относительно целевой Game Repository модели.

Положительный момент: есть интерфейс `IGameRepository`, значит граница уже намечена. Нужна явная стратегия замены local-file реализации.

### 4.4. Readiness не проверяет реальную готовность content subsystem

`buildReadinessResponse` заявляет проверку content subsystem, но `checkContentSubsystem` фактически возвращает `ok`, если модуль импортирован. Он не проверяет доступность `games`, валидность текущего манифеста или возможность загрузки UI manifest.

Риск: `/readiness` может быть зеленым, когда runtime не сможет создать игровую сессию.

### 4.5. Сессии не соответствуют целевой persistence-модели

ADR и архитектурные документы описывают PostgreSQL, `state_version`, `last_event_sequence`, блокировки и восстановление. Фактический `runtime-api` использует `InMemorySessionStore`.

Это допустимый этап миграции, но он должен быть явно помечен как текущий runtime debt, потому что потеря процесса равна потере всех сессий.

### 4.6. Контракты еще несут следы Antarctica-specific bounded slice

`packages/contracts/manifest/src/index.ts` в типах остается в основном универсальным, но комментарии и часть терминов описывают `S1`, opening-tail screens, `55..60`, `i19`, `i21`. Для текущей игры это понятно, но общий contracts package должен быть нейтральным.

Риск: будущие игры начнут копировать Antarctica-модель как платформенный стандарт, даже если им нужен другой flow.

### 4.7. Конфигурация `player-web` не готова к нескольким окружениям

`apps/player-web/next.config.ts` проксирует runtime на `http://localhost:3001`. Для локальной разработки это нормально, но адрес не вынесен в переменные окружения.

Также в `next.config.ts` нет `transpilePackages` для локальных workspace-пакетов. Сейчас сборка может работать за счет прямых `file:` зависимостей и TypeScript-исходников, но это хрупко для монорепозитория.

## 5. Анализ структуры проекта

### 5.1. Что сделано хорошо

- Верхний уровень логично разделен на `apps`, `services`, `packages`, `games`, `SDK`, `docs`, `scripts`, `data`.
- Канонический игровой пакет `games/antarctica` отделен от runtime и player delivery.
- `packages/contracts/*` выделяют общие типы между backend и frontend.
- Есть `PROJECT_STRUCTURE.yaml` как машинно-читаемая карта.
- Есть `.desc.json` для многих значимых каталогов.
- `draft` исключен из `PROJECT_STRUCTURE.yaml`, что снижает шум для агентов.

### 5.2. Основные структурные проблемы

1. `PROJECT_STRUCTURE.yaml` не отражает часть реально документированных каталогов.
   В файловой системе есть `.desc.json` для `services/game-engine`, `services/game-repository`, `services/router`, но в `PROJECT_STRUCTURE.yaml` под `services` показаны только `portal-backend` и `runtime-api`.

2. В документах и задачах осталось много ссылок на `PROJECT_STRUCTURE.md`.
   Корневые правила уже говорят про `PROJECT_STRUCTURE.yaml`, но `PROJECT_ARCHITECTURE.md`, `docs/architecture/README.md` и ряд task-файлов продолжают ссылаться на старое имя.

3. `services/router` находится в промежуточном состоянии.
   В нем есть контракты очереди событий и восстановления, но нет package-файла, tsconfig и включения в workspace. Поэтому код выглядит реализованным, но не имеет жизненного цикла проверки.

4. `SDK/viewers/web-base` находится между документацией и продуктовым пакетом.
   Он имеет `package.json` и `src`, но не входит в workspaces и содержит неверное имя зависимости.

5. В дереве присутствуют локальные сборочные артефакты.
   Видны `apps/player-web/.next`, `apps/player-web/node_modules`, `services/runtime-api/.next`. Даже если они не отслеживаются Git, они мешают структурному анализу и повышают риск случайного включения в отчеты или проверки.

6. Есть пустые или полупустые зоны без явного статуса.
   Например, `apps/player-web/src/hooks` пустой, сервисные каталоги частично содержат только `.gitkeep`, а часть из них не видна в `PROJECT_STRUCTURE.yaml`.

### 5.3. Структурный вывод

Текущая структура подходит для переходного монорепозитория, но ей нужен один явный статусный слой: `canonical`, `draft`, `scaffold`, `archive`, `generated`. Сейчас эти статусы частично описаны в текстах, но не всегда видны из `PROJECT_STRUCTURE.yaml`, package graph и проверок.

## 6. Проверки

Выполнены 2026-05-18:

| Команда | Результат |
| --- | --- |
| `npm run typecheck --workspace services/runtime-api` | Не прошла. Ошибки: нет декларации `json-logic-js`, несовпадение тестового `RuntimeManifestActionDefinition`, неверная форма `JsonLogicExpression`. |
| `npm test --workspace services/runtime-api` | Не прошла. 54 passed, 17 failed. Основные падения в opening-flow после action template/JsonLogic изменений. |
| `npm run typecheck --workspace @cubica/player-web` | Прошла. |
| `npm test --workspace @cubica/player-web` | Не прошла. 93 passed, 4 failed. Падают проверки journal rendering. |

Полный `npm run verify:canonical` не запускался отдельно, потому что его составные проверки уже показали падения.

## 7. Рекомендации

### 7.1. Срочно, до новых архитектурных изменений

1. Восстановить зеленый canonical verification.
   Сначала исправить `runtime-api` typecheck, затем 17 падающих integration tests opening-flow. После этого исправить 4 теста журнала в `player-web`.

2. Синхронизировать фактический статус с документами.
   Пока проверки красные, убрать формулировки вида "уже покрывает весь opening flow" или добавить рядом явный блок "текущая регрессия, дата, команды, симптомы".

3. Исправить `PROJECT_STRUCTURE.yaml` и ссылки на `PROJECT_STRUCTURE.md`.
   Решить, должны ли service scaffolds попадать в YAML. Если да, перегенерировать через `node scripts/dev/generate-structure.js`. Если нет, описать правило исключения.

4. Обновить legacy-реестры.
   `stubs-register.md` должен отражать активные записи `debt-log.csv`, а устаревшие статусы вроде `SDK/viewers не реализован` должны быть уточнены.

5. Починить workspace-граф.
   Либо добавить `SDK/viewers/web-base` в root workspaces и исправить `@cubica/shared` на фактическое имя, либо явно переместить/пометить пакет как draft.

### 7.2. Ближайшие 1-2 недели

1. Перевести JSON Schema validation в строгий режим.
   Начать с `strict: "log"` или отдельной CI-проверки схем, затем перейти к `strict: true`. Семантические проверки ссылок оформить как отдельный schema/compiler validation step и задокументировать.

2. Ввести root TypeScript project references.
   Добавить tsconfig на уровне пакетов контрактов и связать `runtime-api`, `player-web`, SDK-пакеты через явный граф.

3. Развести документы на "current architecture" и "target architecture".
   В `PROJECT_ARCHITECTURE.md` оставить текущий slice как факт, а Router/Game Engine/Game Repository/Metadata DB описывать как target/scaffold с явным статусом.

4. Настроить реальные `build`, `test`, `lint` scripts или убрать их из стандартного пути.
   Скрипт, который всегда делает `exit 1`, полезен как предупреждение, но вреден как package lifecycle interface.

5. Вынести runtime URL из `next.config.ts`.
   Использовать переменную окружения для destination rewrite и добавить локальный default.

### 7.3. Средний срок

1. Подготовить замену `LocalFileGameRepository`.
   Оставить local-file как dev adapter, но добавить configurable repository port: filesystem, object storage или backend repository.

2. Сделать readiness честным.
   Проверять хотя бы загрузку и валидацию дефолтного game manifest, режим session store и доступность критичных путей.

3. Пометить session persistence debt.
   Пока используется `InMemorySessionStore`, это должно быть явно видно в `debt-log.csv` или отдельном current-state документе.

4. Очистить общие контракты от Antarctica-терминов.
   Комментарии и примеры про `S1`, `i21`, `55..60` перенести в docs/gameplay-slices или plugin-документацию. В `packages/contracts` оставить нейтральные термины.

5. Ввести статусную классификацию каталогов.
   Для `PROJECT_STRUCTURE.yaml` и `.desc.json` добавить поле или соглашение: `canonical`, `draft`, `scaffold`, `archive`, `generated`.

### 7.4. Архитектурное правило на будущее

Любой новый архитектурный шаг должен начинаться с восстановления проверок текущего canonical slice. Иначе проект будет накапливать не запланированный техдолг, а неконтролируемый архитектурный дрейф.
