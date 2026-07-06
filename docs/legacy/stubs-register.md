# Реестр заглушек платформы

Документ фиксирует все временные заглушки в сервисах и SDK. Каждая запись должна ссылаться на строку в `debt-log.csv` и иметь план снятия.

## Оглавление

- [Формат записи](#формат-записи)
- [Процесс обновления](#процесс-обновления)
- [Текущие заглушки](#текущие-заглушки)
- [Архив заглушек](#архив-заглушек)

## Формат записи
| Поле | Описание |
| --- | --- |
| `id` | Уникальный идентификатор заглушки, совпадает с колонкой `id` в `debt-log.csv`. |
| `component` | Сервис или SDK, где расположена заглушка. |
| `location` | Путь к файлу/каталогу и дополнительный контекст. |
| `introduced_in` | Версия или PR, в котором добавлена заглушка. |
| `removal_plan` | Краткий план удаления и целевая фаза. |
| `owner` | Ответственный за снятие. |
| `status` | Текущий статус: `active`, `in-progress`, `removed`. |
| `notes` | Дополнительная информация (риски, связи с задачами). |

## Процесс обновления
1. При добавлении новой заглушки создайте запись в `docs/legacy/debt-log.csv` и добавьте строку в таблицу ниже.
2. Заглушка без плана снятия недопустима — заполните `removal_plan` и `phase_remove` в CSV.
3. Каждая запись привязана к задаче/issue. Указывайте ссылку в поле `issue_link` CSV.
4. Во время ревью обновляйте `last_reviewed_at` (формат `YYYY-MM-DD`) и статус.
5. После удаления заглушки перемещайте строку в блок "Архив" в этом документе.

## Текущие заглушки
| id | component | location | introduced_in | removal_plan | owner | status | notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| LEGACY-0001 | game-engine | data/mocks/llm/default-response.json | стартовый commit | Заменить на интеграцию с LLM к Phase1 | Game Engine Team | active | Требуется контракт API с Router |
| LEGACY-0003 | game-engine | services/game-engine/ | architecture repair review | Реализовать или удалить standalone Game Engine service boundary в Phase1 | Backend Team | active | Сейчас canonical runtime path находится в `services/runtime-api` |
| LEGACY-0004 | backend services | services/game-catalog/ | architecture repair review | Реализовать или классифицировать Catalog/Editor/Repository/Metadata services в Phase1 | Backend Team | active | Сервисы остаются target/scaffold boundaries |
| LEGACY-0006 | extension-packs | docs/architecture/adrs/015-extension-packs-architecture.md | ADR-015 | Реализовать Extension Packs runtime/SDK path в Phase2 | Engine Team | active | `SDK/extensions/` отсутствует намеренно; актуальная ссылка ведет на архитектурное решение ADR-015 |
| LEGACY-0009 | runtime-api | services/runtime-api/src/modules/session/inMemorySessionStore.ts | canonical runtime slice | Заменить на PostgreSQL-backed persistence в `TSK-20260518-session-persistence-hardening` | Backend Team | active | Runtime state теряется при рестарте процесса |
| LEGACY-0010 | runtime-api | services/runtime-api/src/modules/player-api/httpServer.ts readiness endpoint | canonical runtime slice | Проверять загрузку content bundle в `TSK-20260518-runtime-repository-boundary-and-readiness` | Backend Team | active | Сейчас endpoint подтверждает процесс, но не content readiness |
| LEGACY-0012 | services/router | services/router | historical target architecture | Классифицировать как archived target или contracts-only scaffold в `TSK-20260518-workspace-project-references-cleanup` | Backend Team | active | В текущем canonical slice runtime-api владеет boundary |
| LEGACY-0013 | portal-backend | services/portal-backend | portal launch slice | Удалить payment stub или закрыть production policy после test VPS/payment integration | Portal Team | active | Доступен только при `PAYMENT_STUB_ENABLED=true`; backend markers покрывают payment-stub route/controller/readme |
| LEGACY-0014 | runtime-api plugins | docs/architecture/adrs/040-runtime-api-plugin-architecture.md | ADR-040 | Реализовать runtime plugin runner отдельным slice только после доказанной необходимости; до этого использовать manifest/platform capabilities | Backend Team | active | Полноценные runtime-api plugins не входят в Antarctica cleanup; доверенные исключения требуют отдельного ревью |
| LEGACY-0016 | JSON Schema validation | docs/tasks/active/TSK-20260518-json-schema-strict-validation.md | object-state architecture review 2026-06-13 | Удалить или детально разнести все `strict: false`/imperative companion checks при выполнении strict validation task | Platform Team | active | Исключения из ADR-025 допустимы только как зафиксированное legacy с владельцем и правилом снятия |
| LEGACY-0019 | editor-engine | packages/editor-engine/src/role-inference.ts | full project review 2026-06-27 | Явная роль `_type`/`role`/`_semantics` теперь авторитетна и применяется до эвристик; подстроковый матчинг остаётся только задокументированным fallback | Frontend Team | active | Не-английские манифесты с явной ролью больше не деградируют; fallback по английским подстрокам — известное ограничение |
| LEGACY-0023 | player-web | apps/player-web/public/images/ | game-asset-channel design 2026-07-06 | Мигрировать файлы «Антарктиды» в `games/antarctica/assets/` и ссылки на форму `asset:<id>` отдельной задачей после реализации ADR-063 | Content Team | active | До миграции абсолютные `/images/...` URL остаются поддержанными; см. `TSK-20260706-game-asset-channel` |
| LEGACY-0024 | observability | docs/architecture/PROJECT_ARCHITECTURE.md | architecture review 2026-07-06 | Написать ADR наблюдаемости и лимитирования и завести активную задачу (требование PROJECT_ARCHITECTURE §5) | Platform Team | active | Логи/метрики/трейсинг сейчас — декларация без контракта и проверок |
| LEGACY-0025 | security | PROJECT_OVERVIEW.md | architecture review 2026-07-06 | Спроектировать платформенную модель authn/authz (роли, RBAC, auth endpoints runtime-api, связь с join-токенами ADR-059) до публичного test VPS launch | Platform Team | active | Единственное реальное решение сейчас — auth-gate внешнего agent backend (ADR-047) |
| LEGACY-0026 | deployment | PROJECT_OVERVIEW.md | architecture review 2026-07-06 | Оформить модель развёртывания как ADR (минимум — test VPS) вместо декларации из PROJECT_OVERVIEW §5 | Platform Team | active | Единственная исполнительная точка — задача test VPS портала |
| LEGACY-0027 | portal-licensing | docs/architecture/adrs/033-portal-runtime-session-binding.md | architecture review 2026-07-06 | Написать ADR лицензирования/ценообразования/платёжной интеграции | Portal Team | active | Типы лицензий существуют только внутри ADR-033; связано с LEGACY-0013 (payment stub) |
| LEGACY-0028 | game-catalog | services/game-catalog/ | architecture review 2026-07-06 | Спроектировать жизненный цикл публикации игры и архитектуру Game Catalog (включая модель событий аналитики) | Backend Team | active | Проработаны только published plugin bundles (ADR-039) и поиск (qdrant.md); связано с LEGACY-0004 |
| LEGACY-0029 | agent-runtime | docs/architecture/ai-agent-safety-remediation.md | architecture review 2026-07-06 | Спроектировать реальный LLM provider adapter и persisted audit store для Agent Runtime | Backend Team | active | Весь AI-driven контур реализован против mock-адаптера; связано с LEGACY-0001 |
| LEGACY-0030 | replay-eval | docs/architecture/testing-strategy.md | architecture review 2026-07-06 | Создать исполнительную программу replay/eval runner (обязательный production-гейт AI-driven игр по ADR-046) | Platform Team | active | Существуют только контракты и фикстуры; объявленный гейт непроходим |
| LEGACY-0032 | authoring layer | docs/architecture/adrs/030-semantic-prototype-manifests.md | architecture review 2026-07-06 | Принять ADR-030 и закрыть остатки (CI-блокировка generated drift) либо переописать границы решения | Platform Team | active | Статус Draft при частично реализованном authoring-слое |
| LEGACY-0033 | knowledge architecture draft | docs/architecture/hybrid-knowledge-architecture-v0.5.md | architecture review 2026-07-06 | Классифицировать документ: связать с ADR/треком Cubica либо вынести из канонического архитектурного каталога | Platform Team | active | Черновик не связан с ADR-системой Cubica и ссылается на чужую нумерацию решений |
| LEGACY-0034 | editor mockup flow draft | docs/architecture/game-ui-mockup-flow.md | architecture review 2026-07-06 | Провести согласование и оформить поток «текст → макет → прототип UI» как ADR с обновлением PROJECT_ARCHITECTURE | Frontend Team | active | Требование оформления в ADR записано в самом черновике |
| LEGACY-0035 | delivery channels | docs/architecture/PROJECT_ARCHITECTURE.md | architecture review 2026-07-06 | Сделать эскизы архитектуры каналов Telegram (бот/view adapter поверх Surface projections) и Mobile | SDK Team | active | Для Telegram есть только projection contracts; Mobile не проработан вовсе |
| LEGACY-0036 | editor-web hosting | docs/architecture/editor-preview-first-ux.md | architecture review 2026-07-06 | Спроектировать хостируемый многопользовательский редактор (авторизация авторов, изоляция проектов, коллаборация) | Frontend Team | active | Текущий editor-web — локальный инструмент с Git worktree-сессиями; при активации потребуется ADR о доставке недоверенного кода (наследник отклонённой части ADR-014, см. ADR-064) |
| LEGACY-0037 | external SDK | docs/architecture/adrs/064-headless-core-and-channel-adapters.md | ADR-064 (2026-07-07) | Опубликовать извлечённый `player-core` + сгенерированный из OpenAPI клиент при появлении внешнего потребителя (бизнес-кейс встраивания игр; связано с LEGACY-0027/0028) | SDK Team | active | Отложенная, но планируемая работа; до внешнего потребителя semver-обязательства не берутся |
| LEGACY-0038 | client code trust | docs/architecture/adrs/064-headless-core-and-channel-adapters.md | SDK-развилка ADR-064 (2026-07-07) | Спроектировать новым ADR конвейер доверия стороннего клиентского кода (анализ → ревью → подпись/каталог → sandbox) при активации маркетплейса/хостируемого редактора (LEGACY-0036) | Platform Team | active | Наследник отклонённой части ADR-014; по ADR-040 нужна container/WASI-изоляция, подпись и ревью недостаточны; content-hash бандлы (ADR-039/063) дают целостность, но не доверие |
| LEGACY-0039 | player-web renderer | docs/architecture/adrs/055-player-renderer-purity-and-declarative-ui-action-binding.md | SDK-развилка ADR-064 (2026-07-07) | Декомпозировать рендерер на «ядро + жанровые UI capability packs» по ADR-066 (реестр типов компонентов вместо статических импортов, ленивые пакеты по объявлению манифеста) при срабатывании триггеров | Frontend Team | active | Ось и триггеры — ADR-066; датчик — CI-бюджет бандла (`TSK-20260707-player-web-bundle-budget`); прецедент lazy-канала — Phaser (ADR-062) |

## Архив заглушек
| id | component | location | introduced_in | removal_plan | owner | status | notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| LEGACY-0002 | antarctica-nextjs-player | games/antarctica-nextjs-player/src/app/api/submit/route.js | CP_00024 | Удалить после подключения к реальному Router API (Phase1) | Frontend Team | removed | Плеер полностью заменен на apps/player-web |
| LEGACY-0005 | SDK/viewers | SDK/viewers/ | architecture repair review | Закрыто ADR-064: реестр viewers отклонён, роль закрыта рендерером ADR-055 и плагинами ADR-037/039 | SDK Team | removed | Каталог удалён вместе с упразднением `SDK/` (2026-07-07) |
| LEGACY-0011 | SDK/viewers/web-base | SDK/viewers/web-base | pre-canonical SDK scaffold | Закрыто ADR-064: scaffold удалён вместе с упразднением `SDK/` | SDK Team | removed | Классификация workspace-статуса больше не требуется (2026-07-07) |
| LEGACY-0021 | SDK/react-sdk | SDK/react-sdk | full project review 2026-06-27 | Закрыто ADR-064: мёртвые каталоги физически удалены; живая часть sdk-core перенесена в `packages/view-protocol` | Platform Team | removed | Сессионная заготовка `createSession` и legacy `applyStateUpdates` удалены при переносе (2026-07-07) |
| LEGACY-0031 | SDK strategy | docs/architecture/adrs/014-viewers-library-architecture.md | architecture review 2026-07-06 | Решено ADR-064: стратегия «headless core + адаптеры каналов», ADR-014 помечен Superseded | Platform Team | removed | Шов будущего player-core охраняется `verify:player-core-seam`; внешний SDK отложен как LEGACY-0037 (2026-07-07) |
| LEGACY-0007 | antarctica-player | games/antarctica-nextjs-player/src/app/data/antarctica/manifest.json | CP_00024 | Удалить при переходе на SSOT | Content Team | removed | Плеер удален, данные берутся из games/antarctica |
| LEGACY-0008 | canonical-slice | npm run verify:canonical | TSK-20260518 | Восстановить зеленые canonical checks | Platform Team | removed | Закрыто: `npm run verify:canonical` проходит 2026-05-18 |
| LEGACY-0015 | player-web plugin API | apps/player-web/src/plugins/player-plugin-api.ts | object-state architecture review 2026-06-13 | Удалено после проверки текущего `player-web` и `Antarctica` plugin path | Frontend Team | removed | `readCardFlags` снят из публичного plugin API; current runtime/player behavior читает `objects.cards` через `readCardObjects` |
| LEGACY-0017 | antarctica-game-manifest | games/antarctica/authoring/game.authoring.json | object-state architecture review 2026-06-15 | Удалено в `TSK-20260615-antarctica-ui-only-actions-cleanup` | Content Team | removed | UI-only actions showHint/showTopBar/showScreenWithLeftSideBar сняты с логического game manifest; подсказка перенесена в UI manifest/Presenter per ADR-053 |
| LEGACY-0018 | editor-engine | packages/editor-engine/src/index.ts | full project review 2026-06-27 | Закрыто в `TSK-20260630-editor-engine-modularization`: Phases 1-3 (2026-07-04) разбили editor-engine на модули с тонким фасадом; Phase 4 (2026-07-05) декомпозировал компонент EditorWorkspace | Frontend Team | removed | EditorWorkspace — тонкая композиция; состояние в доменных хуках за контроллером `useEditorWorkspace`, панели в `apps/editor-web/src/components/workspace/`; последний дубль `isPlainJsonObject` заменён каноническим экспортом; поведение сохранено (typecheck, 105 unit, verify:editor-engine 38, e2e:prod 8/8) |
| LEGACY-0020 | runtime-api | services/runtime-api/src/modules/runtime/deterministicHandlers.ts | full project review 2026-06-27 | Все game-specific guard-ы (board/team/teamSelection/opening) мигрированы на generic collectionCount/stateConditions в `TSK-20260630-runtime-guard-reconciliation` | Platform Team | removed | Формы удалены из платформенной схемы/контрактов; pointer-чтение унифицировано; `(guard as any)` убраны; runtime-api 127/127 |
| LEGACY-0022 | player-web | apps/player-web/src/lib/metric-projection.ts | full project review 2026-06-27 | Решено через документированное подмножество в `TSK-20260630-codebase-cleanup-and-workspace-status` | Frontend Team | removed | `SUPPORTED_METRIC_JSONLOGIC_OPERATORS` + `scripts/ci/validate-metric-jsonlogic-subset.js` в verify:canonical: computed-метрики не могут использовать операторы вне подмножества → каналы не расходятся |
