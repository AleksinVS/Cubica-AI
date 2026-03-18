# Реестр заглушек платформы

Документ фиксирует все временные заглушки в сервисах и SDK. Каждая запись должна ссылаться на строку в `debt-log.csv` и иметь план снятия.

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
| LEGACY-0002 | antarctica-nextjs-player | games/antarctica-nextjs-player/src/app/api/submit/route.js | CP_00024 | Удалить после подключения к реальному Router API (Phase1) | Frontend Team | active | Dev-заглушка Router для Next.js-плеера; запись в debt-log LEGACY-0002 |

## Архив заглушек
| id | component | location | introduced_in | removal_plan | owner | status | notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
