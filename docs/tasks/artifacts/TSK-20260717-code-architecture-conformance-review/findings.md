# Находки ревью кода и архитектурного соответствия

## Оглавление

- [1. Базовая линия и метод](#1-базовая-линия-и-метод)
- [2. Блокирующие находки](#2-блокирующие-находки)
- [3. Реестр остальных находок](#3-реестр-остальных-находок)
- [4. Дрейф архитектурной документации](#4-дрейф-архитектурной-документации)
- [5. Свежие проверки](#5-свежие-проверки)
- [6. Ограничения](#6-ограничения)

## 1. Базовая линия и метод

- Дата ревью: 2026-08-31.
- Каноническая базовая линия: `origin/main` на commit
  `1f916d5eed7603f63107be543902d8456b921047`.
- Ревью выполнено в изолированной копии этой базовой линии, потому что
  исходный worktree находился на расходящейся ветке и содержал изменения
  параллельного агента.
- Проверены runtime, persistence, Mechanics, Player Web, Editor, preview,
  Portal, Product Context, контракты, игровые пакеты, CI и статусы ADR.
- Каждая находка ниже отсутствовала в активном реестре долга либо
  противоречила записи, помеченной как закрытая. Уже зарегистрированный долг
  не дублируется.

Серьёзность означает:

- `blocker` — возможны потеря данных, обход границы доверия либо полная
  неработоспособность обязательного сценария;
- `high` — воспроизводимая ошибка или нарушение принятого инварианта с
  существенным пользовательским/операционным эффектом;
- `medium` — ограниченная ошибка, слабый контрольный шлюз или устойчивый
  архитектурный дрейф без немедленной потери данных;
- `low` — локальная неоптимальность либо документационная неточность.

## 2. Блокирующие находки

### F-001. Гонка повторного захвата аренды Editor допускает двух владельцев

- Область: `apps/editor-web/src/lib/editor-session-lease.ts`, функции
  обнаружения и удаления устаревшей аренды.
- Инвариант: Save, Restore, Close и GC одной authoring-сессии выполняются
  только одним межпроцессным владельцем.
- Свидетельство: два претендента могут прочитать владельца A как устаревшего;
  первый удаляет A и создаёт B, после чего второй безусловно удаляет уже B и
  создаёт C. B и C затем одновременно считают аренду своей.
- Последствие: конкурирующие Save/Restore/GC способны потерять пользовательские
  изменения или удалить рабочее дерево во время записи.
- Документация: не зарегистрировано; прежняя запись `LEGACY-0051` помечена
  как закрытая.
- Исправление: атомарное захватывание с уникальным поколением/токеном и
  отрицательный тест `stale A -> claim B -> delayed contender cannot remove B`.
  Если исправление потребует смены постоянного формата аренды, сначала
  классифицировать миграцию хранения по архитектурным правилам.

### F-002. Portal не может создать первую Runtime-сессию

- Область: `services/portal-backend/src/api/launch-session/services/launch-session.js`,
  `docs/architecture/runtime-api-openapi.yaml`, Runtime request validation.
- Инвариант: Portal вызывает канонический `CreateSessionRequest`; личность
  игрока не берётся из доверенного поля тела запроса.
- Свидетельство: Portal всегда отправляет `{gameId, playerId}`, но строгая
  Runtime-схема не содержит `playerId` и запрещает дополнительные поля.
- Последствие: первое открытие валидной portal-ссылки получает HTTP 400 и не
  создаёт binding.
- Документация: противоречит закрытому `LEGACY-0060`.
- Исправление: удалить `playerId` из запроса Portal и добавить настоящий
  contract/integration test Portal -> Runtime. Нового решения PM не требуется.

### F-003. Preview content reload не связывает файл с сессией и отпечатком

- Область: `services/runtime-api/src/modules/player-api/httpServer.ts`,
  маршруты загрузки и чтения preview-плагина.
- Инвариант: authoring preview может исполнять только байты, принадлежащие
  текущей аутентифицированной сессии и совпадающие с объявленным отпечатком.
- Свидетельство: reload доступен без аутентификации, позволяет выбрать сам
  разрешённый корень, принимает относительный путь к другому worktree,
  проверяет только лексическое вхождение пути и не сверяет hash фактических
  байтов; символическая ссылка и подмена файла после регистрации не
  исключены.
- Последствие: межсессионное чтение файлов, выход через symlink и исполнение
  подменённого кода под прежним hash в пределах общего preview-host.
- Исправление: аутентифицировать reload, привязать разрешённый realpath к
  session-owned worktree, принимать только обычный `.mjs`, проверять hash
  фактических байтов и читать зарегистрированный immutable artifact.

## 3. Реестр остальных находок

| ID | Риск | Область | Проблема и требуемый результат | Решение PM |
| --- | --- | --- | --- | --- |
| F-004 | high | Editor mutations | `/api/editor/apply` и layout-запись обходят общую аренду и принимают сырой file text без обязательного `EditorChangeSet`, expected hash, schema/dry-run и undo journal. Все пользовательские мутации должны идти через один транзакционный путь. | Нет, восстановление принятой границы. |
| F-005 | high | Editor GC | Orphan-GC удаляет worktree без свежего `git status`; требуется повторная проверка непосредственно под арендой перед удалением. | Нет. |
| F-006 | high | Editor cleanup | Проверка допустимого cleanup-root не закрывает symlink/TOCTOU; нужны descriptor/realpath-based проверки непосредственно перед операцией. | Только если меняется формат/хранилище. |
| F-007 | high | Editor risk | Путь вида `games/x/authoring/../../../package.json` классифицируется как структурный и обходит dangerous approval. Сначала требуется канонизация и containment. | Нет. |
| F-008 | high | Compile cache | Наличие parseable manifest/source map ошибочно считается валидным кэшем; tampered cache обходит compiler, leak и semantic gates. Ключ должен покрывать входы/версию компилятора, а hit — проверять целостность выходов. | Нет. |
| F-009 | medium | Editor L2 cache | Поверхностное восстановление значения может бросить исключение вместо cache miss. Требуется schema-backed либо полный структурный guard и fail-closed miss. | Нет. |
| F-010 | high | Editor approvals | Save/Undo approval scopes можно повторно использовать; save привязан к base version, а undo — только к длине журнала. Approval должен быть одноразовым и связанным с точным текущим изменением. | Нет, если не меняется публичный approval contract. |
| F-011 | medium | Editor Agent UI | Локальный AG-UI route остаётся активным при выключенном основном runtime feature flag. Все входы должны следовать единому readiness/enablement gate. | Нет. |
| F-012 | medium | Editor context | Product Context projection не имеет общего точного byte-limit и честного признака truncation. Ограничение должно применяться до передачи модели. | Нет. |
| F-013 | high | Runtime admission | Actions и agent-turns читают/валидируют JSON до bearer-auth, раскрывая детали схемы и позволяя анонимно расходовать CPU/память. Аутентификация и грубый предел тела должны предшествовать подробной валидации. | Нет. |
| F-014 | medium | Runtime admission | Проверка роли/intent следует после проверки версии, поэтому недопущенный principal получает сведения о состоянии версии. Role/intent gate должен предшествовать version gate. | Нет. |
| F-015 | high | Mechanics budgets | Metric audit добавляется после event-budget; число metrics и длина `metricId` не ограничены согласованно с downstream caps. Все производные события должны входить в единый бюджет. | Нет, если сохраняются принятые пределы. |
| F-016 | high | Road preview | Preview дорог является вторым неполным исполнителем: не проверяет external invocation, `when`, work meter и может расходиться с confirm. Preview и confirm должны вызывать один чистый расчётный путь. | Нет, принято ADR-099/100. |
| F-017 | high | Agent Runtime | Mock Agent Runtime можно включить в production одним флагом. Production readiness должен fail closed независимо от dev fixture flag. | Нет. |
| F-018 | high | Preview restore | Авторизация restore проверяется до session transaction lock, поэтому credential может смениться до записи. Проверка principal/credential должна быть повторена под lock. | Нет. |
| F-019 | high | Player invite | Invite fragment удаляется только после активации игрового плагина; плагин может его прочитать, а ошибка загрузки оставляет secret в URL. Fragment нужно потребить до недоверенного кода и очистить в `finally`. | Нет. |
| F-020 | high | Player outbox | Pending command хранится только по `sessionId`; после handoff он может быть отправлен credential другого principal. Ключ/запись должны включать стабильную principal/credential generation. | Нет, если identity уже доступна; иначе публичный контракт. |
| F-021 | medium | Player SSE | После временного неуспеха full GET resync-маркер очищается, и клиент может навсегда остаться на устаревшем снимке. Маркер снимается только после подтверждённой синхронизации. | Нет. |
| F-022 | medium | Player plugins | Session-scoped plugin configuration/factory остаются в глобальных реестрах после завершения сессии. Требуется lifecycle disposal и тест последовательных сессий. | Нет. |
| F-023 | high | Safe mode | Общий `SafeModeRenderer` содержит предметные представления и синтезирует действия из runtime state. Он должен рендерить только опубликованные bindings либо честный нейтральный fallback. | Нет, восстановление ADR-045/084. |
| F-024 | medium | Card renderer | Компонент синтезирует `cardId` из DOM id. Идентификатор действия должен приходить из опубликованного binding/props. | Нет. |
| F-025 | high | Manifest actions | Доступность кнопки связывается с UI command, а не опубликованным `actionId`. Требуется единая identity action definition. | Нет. |
| F-026 | medium | Cubica Surface | Рендерер не проверяет версию каталога компонентов и не валидирует schema props. Нужна явная граница совместимости. | **Да, AD-04.** |
| F-027 | medium | Hybrid runtime | Недоступность Agent Runtime блокирует и детерминированные части hybrid-игры. Нужно определить обязательную деградацию или честный полный отказ. | **Да, AD-05.** |
| F-028 | high | Preview messaging | `editorOrigin` выбирается родителем; точное сравнение есть, но доверенная привязка отсутствует. Требуется server-defined allowlist либо capability. | **Да, AD-06.** |
| F-029 | high | Preview messages | Межприложенческие сообщения проверяются handwritten shallow guards вместо общей JSON Schema; например `entities:[null]` приводит к исключению. Нужен schema-first контракт и negative corpus. | Нет, если форма не меняется. |
| F-030 | medium | Preview geometry | DOM geometry устаревает при scroll/reflow, а повторные entity ids дают зависимый от порядка результат. Нужна инвалидация и однозначная политика дублей. | Нет. |
| F-031 | high | Portal payments | Клиент задаёт цену, package и период; callback проверяет подпись, но не server-owned коммерческие условия заказа. До принятого каталога реальный платёжный путь должен быть закрыт. | **Да, AD-01.** |
| F-032 | high | Portal payments | Order становится `paid` до создания purchase; ошибка поглощается и получает ACK, повтор уже ничего не восстанавливает. Нужна атомарная/идемпотентная state machine. | **Да, вместе с AD-01 из-за storage/payment boundary.** |
| F-033 | high | Portal resume | Portal хранит только Runtime session id и делает защищённый GET без bearer; повторное открытие не работает. Для нового устройства нужен безопасный claim/reissue, а не хранение сырого bearer. | **Да, AD-02.** |
| F-034 | high | Portal binding | Runtime-сессия создаётся до уникальной вставки binding; конкурирующие запросы оставляют orphan session. Нужна reservation либо межсервисный idempotency key. | **Да, AD-03.** |
| F-035 | high | Portal audit | Внутренние payment/session-launch audit types публикуют core CRUD, зависящий от внешней role-config. Маршруты должны быть закрыты кодом и покрыты route inventory test. | Нет. |
| F-036 | low | Portal errors | Order endpoint отдаёт `error.message`, раскрывая инфраструктурные детали. Нужна стабильная общая ошибка и correlation id в серверном журнале. | Нет. |
| F-037 | high | Product Context lease | Stage 1 lease не имеет fencing token; stale worker с тем же synthetic owner может завершить новую аренду. Каждый claim должен иметь уникальный token/generation. | Нет при повторном использовании существующего поля; иначе решение по storage migration. |
| F-038 | high | HTTP bounds | Editor и Product Context worker вызывают `arrayBuffer()` до фактического лимита 64 KiB. Нужен общий streaming reader с ранней отменой. | Нет. |
| F-039 | medium | Product Context CI | Изоляционная проверка не входит в canonical/CI; текущий substring-validator затрудняет корректное включение. Нужен semantic script inventory и отдельный зелёный gate. | Нет. |
| F-040 | high | Supervisor | После TERM нет ограниченного KILL; зависший child не выходит и supervisor не перезапускает сервис. Нужен двухфазный bounded shutdown. | Нет, в границах ADR-067. |
| F-041 | high | OpenAPI gate | Валидатор проверяет contract -> code, но не инвентаризует code -> contract, поэтому новый маршрут может остаться недокументированным. | Нет. |
| F-042 | medium | Affected selector | Изменение канонического OpenAPI классифицируется как docs-only и может пропустить контрактные проверки. | Нет. |
| F-043 | medium | Skill registry gate | Валидатор проверяет registry -> filesystem, но не filesystem -> registry; незарегистрированный проектный skill остаётся незамеченным. | Нет. |
| F-044 | high | CMT mock | Три focused-теста красные из-за несогласованной случайности/событий, provenance-файл не соответствует схеме, но canonical gate это не видит. Исправить fixture и включить узкий gate. | Нет. |
| F-045 | medium | CMT mock ownership | Builder копирует весь нормативный CMT package, создавая второй неявный источник истины. Mock должен собирать только собственную минимальную fixture поверх явно выбранных общих частей. | Нет. |
| F-046 | medium | Game metrics | Значение метрик `simple-choice`/`ai-driven-choice` живёт только в Web UI, а не в game-owned manifest metadata. Перенести смысл в пакет игры. | Нет. |
| F-047 | high | AI debrief semantics | Схема проверяет форму и существование `eventSequence`, но не запрещает диагнозы и не доказывает связь утверждения с событием, хотя ADR обещает это. | **Да, AD-07.** |
| F-048 | medium | Debrief OpenAPI | Реальный `423 Locked` отсутствует в каноническом OpenAPI и точной проверке статусов. | Нет. |
| F-049 | medium | Debrief UI | Facilitator-only панель показывается обычному участнику; сервер отвечает 401, но UI обещает недоступную возможность. Capability нужно определять до показа. | Нет; финальный UX-проход сильной моделью. |

### 3.1. Проверяемая трассировка F-004..F-049

Для всех строк ниже выполнен поиск по `docs/legacy/debt-log.csv` и
`docs/legacy/stubs-register.md`. Результат — `нет`, если явно не указан
закрытый или смежный идентификатор. `path::symbol` является устойчивой точкой
входа; номер строки сознательно не используется как идентификатор.

- **F-004** — `apps/editor-web/app/api/editor/apply/route.ts::POST` принимает
  `files[{filePath,text}]`, а
  `apps/editor-web/app/api/editor/layout/route.ts::POST` допускает запись без
  session. Это обходит единый `EditorChangeSet -> dry-run -> schema -> journal
  -> apply` из ADR-048/049 и session mutation boundary ADR-042/065; долг: нет.
- **F-005** —
  `apps/editor-web/src/lib/editor-session-store.ts::garbageCollectEditorSessions`
  в orphan-ветке удаляет worktree без непосредственно предшествующего свежего
  Git status под арендой. Это нарушает cleanup invariant ADR-042 § lifecycle;
  долг: нет.
- **F-006** —
  `apps/editor-web/src/lib/editor-session-store.ts::garbageCollectEditorSessions/isEditorWorktreePath`
  проверяет путь отдельно от разрушительной операции и не удерживает
  realpath/descriptor, поэтому symlink/TOCTOU может сменить цель. Инвариант —
  ADR-042/065: GC удаляет только подтверждённый session worktree; долг: нет.
- **F-007** — `packages/editor-engine/src/change-risk.ts::isWithinAuthoringOrAssets`
  классифицирует строковый prefix до полной нормализации; путь с `..` может
  остаться в authoring-классе. ADR-057 §4.5 требует dangerous approval для
  выхода за authoring/assets; долг: нет.
- **F-008** — `scripts/manifest-tools/compile-cache.cjs::readCacheEntry`
  считает hit объект с любыми `manifest` и `sourceMap`, не прогоняя схемы и
  semantic/leak gates. Это нарушает manifest SSOT и schema-first публикацию
  ADR-025/050/084; долг: нет.
- **F-009** —
  `apps/editor-web/src/lib/editor-project-cache.ts::loadProjectionEnvelopeWithCache`
  доверяет вложенным полям parseable envelope; malformed nested value может
  бросить вместо cache miss. ADR-057 считает L2 только производным кэшем;
  долг: нет.
- **F-010** —
  `apps/editor-web/src/components/workspace/use-editor-workspace.ts::saveSession/runAgentUndoTool`
  и `agent-surface.ts::validateEditorAgentApproval` не потребляют approval
  одноразово; scope save основан на base version, undo — на форме журнала, а
  не точном текущем эффекте. ADR-044/047 требует scoped human approval для
  каждого mutating tool call; долг: нет.
- **F-011** —
  `apps/editor-web/src/lib/editor-copilot-runtime-backend.ts::getAgUiBackendReadiness`
  выбирает локальный `/api/editor/agent/ag-ui`, даже когда общий
  `CUBICA_EDITOR_AGENT_RUNTIME` выключен. Это расходится с default-off gate
  ADR-043/044; долг: нет.
- **F-012** —
  `apps/editor-web/src/lib/agent-context-projection.ts::buildEditorAgentContextProjection`
  ограничивает отдельные поля/изображение, но не меряет точные итоговые UTF-8
  bytes всей проекции и потому не всегда честно выставляет top-level
  `truncated`. ADR-044/057 требует bounded redacted context; долг: нет.
- **F-013** — `services/runtime-api/src/modules/player-api/httpServer.ts` в
  ветках `POST /sessions/:id/actions` и `POST .../agent-turns` вызывает
  подробный body validator до bearer authentication. Admission order
  ADR-047/074/084 требует сначала identity и грубый body bound; долг: нет.
- **F-014** —
  `services/runtime-api/src/modules/runtime/actionDispatcher.ts::dispatchAction`
  возвращает version conflict до role/intent denial. ADR-079/084 разделяет
  server-only authorization от публичной version/availability; долг: нет.
- **F-015** —
  `services/runtime-api/src/modules/mechanics/coreOperations.ts::eventEmitStep`
  добавляет metric audit после первичного event measurement; manifest metrics
  и `metricId` не разделяют единый предел с downstream 128/256 caps. ADR-084
  требует общий budget всех событий/аудита одной транзакции; долг: нет.
- **F-016** — `services/runtime-api/src/modules/player-api/httpServer.ts::POST
  /action-previews/transport-road` и
  `modules/runtime/regionRoadPlanner.ts::planMinimumRegionRoad` образуют путь,
  отличный от Mechanics confirm: preview не доказывает external profile,
  `when` и work meter. ADR-099/100 требует один read-only calculation path и
  повторный расчёт confirm; долг: нет.
- **F-017** —
  `services/runtime-api/src/modules/ai/agentRuntimeReadiness.ts::isMockAgentRuntimeEnabled`
  разрешает runtime id `mock` по одному env-флагу без production prohibition.
  ADR-047 требует production readiness fail closed; долг: нет.
- **F-018** — `services/runtime-api/src/modules/player-api/httpServer.ts::POST
  /sessions/:id/preview-restore` аутентифицирует до
  `session.service.ts::restorePreviewSession`/transaction lock и не
  перепроверяет credential generation под lock. ADR-077/084 требует атомарную
  identity/session mutation boundary; долг: нет.
- **F-019** —
  `apps/player-web/src/presenter/runtime-client.ts::consumePrivateInviteFragment`
  только читает fragment, а `game-presenter.ts::boot` предъявляет token после
  загрузки game plugin; при ранней ошибке URL остаётся с secret. Accepted
  ADR-059 требует одноразовый token и отсутствие его в client storage; долг:
  закрытый `LEGACY-0060` не описывает остаток.
- **F-020** —
  `apps/player-web/src/presenter/command-outbox.ts::outboxKey`
  связывает запись только с session id. После credential handoff тот же ключ
  может повторить команду другого principal; ADR-084 требует retry по
  стабильному principal/command identity; долг: нет.
- **F-021** —
  `apps/player-web/src/presenter/runtime-client.ts::subscribeToSessionEvents/fullGet`
  сбрасывает pending refresh в `finally`, даже если `resumeSession` упал;
  последующего события может не быть. ADR-059 требует full authenticated HTTP
  resync после SSE cursor; долг: нет.
- **F-022** —
  `apps/player-web/src/plugins/player-plugin-api.ts::createScopedPlayerPluginApi.registerGameConfigData/registerGameConfigFactory`
  вызывают void-регистрации из
  `apps/player-web/src/presenter/game-config-registry.ts::configDataRegistry/registry`
  и не добавляют disposer в scoped loader. Сценарий: session A регистрирует
  config/factory -> plugin handle A dispose/switch -> session B с тем же
  `gameId` и без новой contribution получает A через
  `resolveRegisteredGameConfigData/buildGameConfig`. Остальные Phaser/action
  registries очищаются, эти две записи остаются. ADR-039/053 требует plugin
  lifecycle ownership; долг: нет.
- **F-023** —
  `apps/player-web/src/components/safe-mode-renderer.tsx::fallbackScreenBuilder`
  читает gameplay state и строит server actions вместо нейтрального fallback
  по published bindings. ADR-045/046/084 запрещает клиенту выводить
  законность/предметную семантику; долг: нет.
- **F-024** —
  `apps/player-web/src/components/manifest/card-component.tsx::CardComponent`
  использует component DOM id как резервный `cardId`. ADR-054/084 требует
  action params только из опубликованной metadata/binding; долг: нет.
- **F-025** —
  `apps/player-web/src/components/manifest/button-component.tsx::ButtonComponent`
  вызывает `isSessionActionUnavailable(session, command)`, где `command`
  может быть UI-командой `requestServer`, а authoritative identity лежит в
  payload `actionId`. ADR-079/084 закрепляет availability по `actionId`; долг:
  нет.
- **F-026** —
  `apps/player-web/src/components/surface/cubica-surface-renderer.tsx::CubicaSurfaceRenderer`
  не сопоставляет `surface.catalogVersion` и component contribution
  `propsSchema`, хотя они объявлены в `packages/contracts/ai/src/index.ts`.
  ADR-045/046 задаёт validated Cubica Surface; долг: нет, решение AD-04.
- **F-027** — `packages/contracts/ai/src/index.ts::validateExecutionModeSemantics`
  и Player readiness трактуют Agent Runtime как required для любого `hybrid`,
  поэтому deterministic actions также блокируются. ADR-046 не определяет
  обязательную degradation policy; долг: нет, решение AD-05.
- **F-028** — `apps/player-web/app/page.tsx::editorPreviewParentOrigin`
  принимает `editorOrigin` из URL родителя и передаёт его
  `editor-preview-bridge.ts`, поэтому сравнение origin не имеет независимого
  доверенного источника. ADR-039/057 требует проверку origin/source с обеих
  сторон; долг: нет, hosted-вариант — AD-06.
- **F-029** —
  `apps/editor-web/src/lib/preview-message-adapter.ts::isPlayerPreviewEntitiesMessage` и
  `apps/player-web/src/components/editor-preview-bridge.ts::isSnapshotRequest/isRestoreRequest`
  дублируют shallow handwritten guards; `entities:[null]` проходит внешний
  array-check и позже падает. Project schema-first rule и ADR-039 требуют один
  cross-app contract; долг: нет.
- **F-030** —
  `apps/player-web/src/components/editor-preview-bridge.ts::collectPreviewEntities`
  измеряет DOM через `getBoundingClientRect`, но не подписан на scroll, а id
  получает суффикс по порядку совпадений. ADR-057/080 требует устойчивый
  renderer adapter/hit-test; долг: нет.
- **F-031** —
  `services/portal-backend/src/api/order/controllers/order.js::create/createPaymentStub`
  копирует `packageType/startDate/endDate/price` из request, хотя server game
  schema содержит цены. Server-owned entitlement boundary ADR-032/033 ещё не
  задаёт коммерческий каталог; долг: `LEGACY-0027` смежный, но не описывает
  fail-open цену; решение AD-01.
- **F-032** —
  `services/portal-backend/src/api/order/controllers/order.js::handlePaymentResult`
  помечает order `paid`, затем отдельно вызывает
  `createPurchaseForPaidOrder`, поглощает ошибку и отвечает ACK. Инвариант
  payment/purchase atomicity следует ADR-032 и принятому portal access task;
  долг: нет, storage/payment решение AD-01.
- **F-033** —
  `services/portal-backend/src/api/launch-session/services/launch-session.js::runtimeSnapshotOrNull`
  читает protected Runtime session без credential, тогда как Portal хранит
  только `runtime_session_id`; Player BFF credential остаётся HttpOnly. ADR-033
  владеет binding, но не cross-device reissue; долг: нет, решение AD-02.
- **F-034** —
  `services/portal-backend/src/api/launch-session/services/launch-session.js::createRuntimeBinding`
  сначала создаёт Runtime session, затем пишет unique `binding_key`, поэтому
  concurrent loser оставляет orphan. ADR-033 требует one binding -> one
  Runtime session; долг: нет, решение AD-03.
- **F-035** —
  `services/portal-backend/src/api/payment-event/routes/payment-event.js` и
  `session-launch-event/routes/session-launch-event.js` создают unrestricted
  core routers. Уже одобренный
  `TSK-20260803-portal-access-control` Plan Amendment закрепляет code-owned
  закрытие ненужных core routes независимо от Strapi role config; долг:
  `LEGACY-0025` только общий RBAC, нового решения не требуется.
- **F-036** —
  `services/portal-backend/src/api/order/controllers/order.js::create`
  возвращает `details: error.message`. Server-side auth/error boundary
  ADR-032 и общий security invariant запрещают инфраструктурные детали;
  долг: нет.
- **F-037** — `packages/product-context/src/kernel.ts::applyOne` использует
  default owner `synthetic-worker`, а
  `packages/product-context/src/postgres.ts::markApplied/markConflict/markFailed`
  проверяют только `lease_owner`. После expiry старый worker может завершить
  новый claim с тем же owner. ADR-101 обещает безопасный retry после lease;
  долг: нет.
- **F-038** —
  `apps/editor-web/src/lib/product-context-shadow.ts::authorizeThroughPortal` и
  `packages/product-context/scripts/run-shadow-worker.ts::reauthorize`
  вызывают `response.arrayBuffer()` до проверки фактических 64 KiB. ADR-101
  требует bounded Portal/model boundary; долг: нет.
- **F-039** — `scripts/ci/validate-product-context-isolation.js` существует,
  но `package.json::verify:canonical*` его не вызывает, а валидатор включения
  использует строковый поиск. ADR-101 требует изоляционный gate до Stage 3;
  долг: нет.
- **F-040** — `scripts/ops/service-supervisor.mjs::healthTick` посылает
  только SIGTERM и ждёт exit; bounded SIGKILL реализован лишь в общем
  `shutdown`. ADR-067 требует ограниченное восстановление зависшего сервиса;
  долг: нет.
- **F-041** — `scripts/ci/validate-runtime-api-openapi.js::EXPECTED_PATHS`
  проверяет заранее перечисленный contract -> code inventory, но не выводит
  фактические routes из `httpServer.ts`; новый code route может отсутствовать
  в обоих списках. ADR-056/059 и schema-first rule требуют двусторонний
  public contract gate; долг: нет.
- **F-042** — `scripts/ci/select-affected-tests.mjs::selectAffected`
  относит `docs/architecture/runtime-api-openapi.yaml` к docs-only, поэтому
  может пропустить API contract checks. ADR-038 требует fail-closed affected
  selection; долг: нет.
- **F-043** — `scripts/ci/validate-project-skills.mjs` обходит entries
  project-skill registry и проверяет их файлы, но не требует registry entry
  для каждого канонического `skills/*/SKILL.md`. Root AGENTS §1 закрепляет
  `skills/` как canonical; долг: нет.
- **F-044** —
  `games/cards-money-trains-mock/tests/mock-package.test.mjs` и transcripts
  расходятся на `mock.news.apply.block-road`/случайном результате, а
  `games/cards-money-trains-mock/asset-provenance.json` не проходит
  `asset-provenance.schema.json`; canonical scripts не запускают этот набор.
  ADR-038/050 требует зелёный published game gate; долг: нет.
- **F-045** —
  `games/cards-money-trains-mock/tools/build-mock-package.mjs::build`
  копирует нормативный `cards-money-trains` corpus целиком и затем патчит его,
  создавая неявное владение двумя пакетами. Manifest SSOT ADR-050 и game-led
  rule требуют game-owned minimal fixture; долг: нет.
- **F-046** — `games/simple-choice/authoring/ui/web.authoring.json` и
  `games/ai-driven-choice/authoring/ui/web.authoring.json::metric_specs`
  задают подписи/смысл метрик, которого нет в game-owned metric metadata.
  ADR-054 разделяет game semantic metric и channel presentation; долг: нет.
- **F-047** —
  `services/runtime-api/src/modules/ai/facilitatorDebriefService.ts::referencesOnlyJournalEvents`
  проверяет только существование sequence, а schema — форму строки; диагноз
  или ложный факт с валидной ссылкой получает `ready`. ADR-104 обещает более
  сильную семантическую гарантию; `LEGACY-0084/0085` про privacy/audit, не про
  truth; решение AD-07.
- **F-048** —
  `services/runtime-api/src/modules/session/postgresSessionStore.ts::beginFacilitatorDebriefAttempt`
  преобразует `55P03` в 423, но operation `POST
  /sessions/{sessionId}/facilitator-debrief` в
  `runtime-api-openapi.yaml` не содержит 423. ADR-056 и public schema rule
  требуют точный status contract; долг: нет.
- **F-049** —
  `games/cards-money-trains/plugins/cards-money-trains-player/src/facilitator-debrief-availability.ts::provideCardsMoneyTrainsFacilitatorDebriefAvailability`
  проверяет только final results, а
  `apps/player-web/src/components/game-player.tsx::facilitatorDebriefAvailable`
  монтирует панель до server capability GET; обычный player видит control и
  получает 401. ADR-079/104 требует facilitator-only availability; долг: нет.

### 3.2. Покрытие блоков ревью

Исходный TSK фактически содержит 15, а не 16 именованных блоков. Ревью
добавило три актуальных среза; итого покрыто 18 областей. Сырые отчёты не
ведут отдельный статус, но эта матрица сохраняет их границы и ограничения.

| Срез | Результат в реестре | Ограничение |
| --- | --- | --- |
| R1 admission/trust | F-002, F-013, F-014 | Без live hostile-load test. |
| R2 Mechanics | F-015, F-016 | Без нагрузочного профиля полного manifest. |
| R3 persistence/journals | F-018 | PostgreSQL не запускался. |
| R4 projection/Agent/OpenAPI | F-003, F-017, F-041, F-048 | Без live provider. |
| P1 presenter/lib | F-020, F-021 | Browser handoff не запускался. |
| P2 renderer/plugins | F-019, F-022, F-024, F-025, F-030, F-049 | Без визуальной приёмки. |
| P3 AI surface | F-023, F-026, F-027 | Без live Agent Runtime. |
| E1 editor-engine/compiler | F-007..F-009 | Без hostile cache corpus. |
| E2 sessions/worktrees | F-001, F-004..F-006, F-010 | Межпроцессный race не воспроизводился тестом. |
| E3 Agent UI | F-011, F-012 | Без external AG-UI backend. |
| E4 preview/workspace | F-028..F-030 | Без browser iframe E2E. |
| C1 contracts/schemas | F-026, F-029, F-041 | Schema migration не проектировалась. |
| G1 game packages | F-044..F-049 | Focused CMT mock 15/18; provenance fail. |
| S1 CI/operations | F-039..F-043 | CI workflow не запускался удалённо. |
| D1 ADR statuses | D-001..D-012 | Неоднозначный status требует PM stop. |
| Portal | F-002, F-031..F-036 | Focused 22/22, без Strapi/Runtime/DB transaction. |
| Product Context | F-037..F-039, D-012 | Без PostgreSQL/Portal/Z.AI. |
| Recent CMT/Estate increments | F-047..F-049; новых Estate findings нет | Без browser visual и live Z.AI. |

## 4. Дрейф архитектурной документации

Эти пункты не вводят новую архитектуру. Они требуют сопоставить более старые
Accepted ADR с уже принятыми поздними решениями и либо уточнить область, либо
пометить запись как superseded. Любая неоднозначность останавливает только
конкретную запись и выносится PM.

| ID | Противоречие |
| --- | --- |
| D-001 | ADR-015 всё ещё описывает per-game in-process/`isolated-vm` engine, хотя ADR-040/084 закрепили bundle + typed Mechanics IR. |
| D-002 | ADR-011 смешивает command queue, mutable event history и WebSocket/deltas с принятой SSE/full projection границей ADR-059. |
| D-003 | ADR-004 продолжает объявлять передачу secret state модели по умолчанию; изменение summary не устранило текст решения. |
| D-004 | ADR-007 разрешает прямые JS handlers/state mutation вразрез с Mechanics IR. |
| D-005 | ADR-009 использует старый manifest media registry и absolute URL syntax вместо ADR-063 assets registry и `asset:<id>`. |
| D-006 | ADR-088 описывает canonical iteration order, который заменён ordered iteration ADR-102. |
| D-007 | Старые road v1 описания конфликтуют с deterministic v3/holes из ADR-100. |
| D-008 | ADR-096 и связанные summary всё ещё местами описывают stateful PRNG после принятого упрощения. |
| D-009 | ADR-006 сохраняет старую Web Gateway/WebSocket deployment-схему; её web/runtime часть нужно явно сузить как заменённую Accepted ADR-059 (modular monolith + SSE/full GET), не объявляя автоматически superseded остальные view-adapter решения ADR-006. |
| D-010 | ADR-012 Proposed описывает `assets.methodology`, а фактическая schema использует `content.methodology`; overview подаёт предложение как норму. |
| D-011 | ADR-016 summary ошибочно помещает history/graph внутрь UI manifest. |
| D-012 | Принятые Product Context timeout bounds `90000/5000/100000/300000` ms не перенесены в ADR-101 и `PROJECT_ARCHITECTURE.md`. |

## 5. Свежие проверки

На точной базовой линии выполнено:

```text
npm run typecheck                                      PASS
npm run verify:canonical                              PASS
npm run verify:mechanics-locks                        PASS
node --test games/cards-money-trains-mock/tests/*.test.mjs
  15 PASS / 3 FAIL
provenance validation for cards-money-trains-mock     FAIL
portal focused tests                                  22 / 22 PASS
git diff --check                                      PASS
```

`verify:canonical` включил 436 успешных Runtime-тестов и 3 пропуска,
367 Player Web тестов и production build, 6 `view-protocol` тестов,
192 `editor-engine` теста, а также typecheck/build Editor Web. Его зелёный
результат не опровергает F-039, F-041, F-042, F-043 и F-044: эти находки как
раз и описывают отсутствующие или односторонние контрольные ворота.

## 6. Ограничения

- Не запускались живые PostgreSQL, Strapi, Z.AI и Robokassa.
- Не выполнялся production two-browser E2E и сравнительная визуальная
  приёмка Player/Editor.
- Portal focused tests не упражняют настоящий Portal -> Runtime, конкуренцию
  binding и транзакцию платежа.
- Находки concurrency/storage должны получить отдельные отрицательные тесты;
  статическое доказательство не заменяет их итоговую приёмку.
- Номера строк сознательно не являются частью идентификатора находки: при
  исправлении они изменятся. Источник отслеживается по пути и символу в
  рабочем TSK/коммите.
