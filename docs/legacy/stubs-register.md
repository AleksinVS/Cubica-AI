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
| LEGACY-0005 | SDK/viewers | SDK/viewers/ | architecture repair review | Реализовать viewer library или сузить workspace scope в Phase1 | SDK Team | active | Viewer scaffold не участвует в canonical player-web path |
| LEGACY-0006 | extension-packs | docs/architecture/adrs/015-extension-packs-architecture.md | ADR-015 | Реализовать Extension Packs runtime/SDK path в Phase2 | Engine Team | active | `SDK/extensions/` отсутствует намеренно; актуальная ссылка ведет на архитектурное решение ADR-015 |
| LEGACY-0009 | runtime-api | services/runtime-api/src/modules/session/inMemorySessionStore.ts | canonical runtime slice | Заменить на PostgreSQL-backed persistence в `TSK-20260518-session-persistence-hardening` | Backend Team | active | Runtime state теряется при рестарте процесса |
| LEGACY-0010 | runtime-api | services/runtime-api/src/modules/player-api/httpServer.ts readiness endpoint | canonical runtime slice | Проверять загрузку content bundle в `TSK-20260518-runtime-repository-boundary-and-readiness` | Backend Team | active | Сейчас endpoint подтверждает процесс, но не content readiness |
| LEGACY-0011 | SDK/viewers/web-base | SDK/viewers/web-base | pre-canonical SDK scaffold | Классифицировать workspace статус в `TSK-20260518-workspace-project-references-cleanup` | SDK Team | active | Scaffold не входит в canonical player-web path |
| LEGACY-0012 | services/router | services/router | historical target architecture | Классифицировать как archived target или contracts-only scaffold в `TSK-20260518-workspace-project-references-cleanup` | Backend Team | active | В текущем canonical slice runtime-api владеет boundary |
| LEGACY-0013 | portal-backend | services/portal-backend | portal launch slice | Удалить payment stub или закрыть production policy после test VPS/payment integration | Portal Team | active | Доступен только при `PAYMENT_STUB_ENABLED=true`; backend markers покрывают payment-stub route/controller/readme |
| LEGACY-0014 | runtime-api plugins | docs/architecture/adrs/040-runtime-api-plugin-architecture.md | ADR-040 | Реализовать runtime plugin runner отдельным slice только после доказанной необходимости; до этого использовать manifest/platform capabilities | Backend Team | active | Полноценные runtime-api plugins не входят в Antarctica cleanup; доверенные исключения требуют отдельного ревью |
| LEGACY-0016 | JSON Schema validation | docs/tasks/active/TSK-20260518-json-schema-strict-validation.md | object-state architecture review 2026-06-13 | Удалить или детально разнести все `strict: false`/imperative companion checks при выполнении strict validation task | Platform Team | active | Исключения из ADR-025 допустимы только как зафиксированное legacy с владельцем и правилом снятия |
| LEGACY-0019 | editor-engine | packages/editor-engine/src/role-inference.ts | full project review 2026-06-27 | Явная роль `_type`/`role`/`_semantics` теперь авторитетна и применяется до эвристик; подстроковый матчинг остаётся только задокументированным fallback | Frontend Team | active | Не-английские манифесты с явной ролью больше не деградируют; fallback по английским подстрокам — известное ограничение |
| LEGACY-0021 | SDK/react-sdk | SDK/react-sdk | full project review 2026-06-27 | Статус решён (2026-07-04): react-sdk/shared убраны из workspaces, exit-1 снят, sdk-core оставлен (used); остаётся опциональное физическое удаление мёртвых dir | Platform Team | active | Ноль production-импортов; агрегатный `npm test --workspaces` больше не падает; мёртвые dir — delete-candidates |

## Архив заглушек
| id | component | location | introduced_in | removal_plan | owner | status | notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| LEGACY-0002 | antarctica-nextjs-player | games/antarctica-nextjs-player/src/app/api/submit/route.js | CP_00024 | Удалить после подключения к реальному Router API (Phase1) | Frontend Team | removed | Плеер полностью заменен на apps/player-web |
| LEGACY-0007 | antarctica-player | games/antarctica-nextjs-player/src/app/data/antarctica/manifest.json | CP_00024 | Удалить при переходе на SSOT | Content Team | removed | Плеер удален, данные берутся из games/antarctica |
| LEGACY-0008 | canonical-slice | npm run verify:canonical | TSK-20260518 | Восстановить зеленые canonical checks | Platform Team | removed | Закрыто: `npm run verify:canonical` проходит 2026-05-18 |
| LEGACY-0015 | player-web plugin API | apps/player-web/src/plugins/player-plugin-api.ts | object-state architecture review 2026-06-13 | Удалено после проверки текущего `player-web` и `Antarctica` plugin path | Frontend Team | removed | `readCardFlags` снят из публичного plugin API; current runtime/player behavior читает `objects.cards` через `readCardObjects` |
| LEGACY-0017 | antarctica-game-manifest | games/antarctica/authoring/game.authoring.json | object-state architecture review 2026-06-15 | Удалено в `TSK-20260615-antarctica-ui-only-actions-cleanup` | Content Team | removed | UI-only actions showHint/showTopBar/showScreenWithLeftSideBar сняты с логического game manifest; подсказка перенесена в UI manifest/Presenter per ADR-053 |
| LEGACY-0018 | editor-engine | packages/editor-engine/src/index.ts | full project review 2026-06-27 | Закрыто в `TSK-20260630-editor-engine-modularization`: Phases 1-3 (2026-07-04) разбили editor-engine на модули с тонким фасадом; Phase 4 (2026-07-05) декомпозировал компонент EditorWorkspace | Frontend Team | removed | EditorWorkspace — тонкая композиция; состояние в доменных хуках за контроллером `useEditorWorkspace`, панели в `apps/editor-web/src/components/workspace/`; последний дубль `isPlainJsonObject` заменён каноническим экспортом; поведение сохранено (typecheck, 105 unit, verify:editor-engine 38, e2e:prod 8/8) |
| LEGACY-0020 | runtime-api | services/runtime-api/src/modules/runtime/deterministicHandlers.ts | full project review 2026-06-27 | Все game-specific guard-ы (board/team/teamSelection/opening) мигрированы на generic collectionCount/stateConditions в `TSK-20260630-runtime-guard-reconciliation` | Platform Team | removed | Формы удалены из платформенной схемы/контрактов; pointer-чтение унифицировано; `(guard as any)` убраны; runtime-api 127/127 |
| LEGACY-0022 | player-web | apps/player-web/src/lib/metric-projection.ts | full project review 2026-06-27 | Решено через документированное подмножество в `TSK-20260630-codebase-cleanup-and-workspace-status` | Frontend Team | removed | `SUPPORTED_METRIC_JSONLOGIC_OPERATORS` + `scripts/ci/validate-metric-jsonlogic-subset.js` в verify:canonical: computed-метрики не могут использовать операторы вне подмножества → каналы не расходятся |
