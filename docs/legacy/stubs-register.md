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

## Архив заглушек
| id | component | location | introduced_in | removal_plan | owner | status | notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| LEGACY-0002 | antarctica-nextjs-player | games/antarctica-nextjs-player/src/app/api/submit/route.js | CP_00024 | Удалить после подключения к реальному Router API (Phase1) | Frontend Team | removed | Плеер полностью заменен на apps/player-web |
| LEGACY-0007 | antarctica-player | games/antarctica-nextjs-player/src/app/data/antarctica/manifest.json | CP_00024 | Удалить при переходе на SSOT | Content Team | removed | Плеер удален, данные берутся из games/antarctica |
| LEGACY-0008 | canonical-slice | npm run verify:canonical | TSK-20260518 | Восстановить зеленые canonical checks | Platform Team | removed | Закрыто: `npm run verify:canonical` проходит 2026-05-18 |
