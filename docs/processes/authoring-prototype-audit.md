# Регулярный аудит кандидатов в authoring-прототипы

Документ описывает поддерживаемую процедуру поиска кандидатов в локальные и платформенные authoring-прототипы. Он исполняет ADR-050 и дополняет процесс ручного повышения в `docs/processes/authoring-prototype-promotion.md`.

## Оглавление

- [1. Назначение](#1-назначение)
- [2. Термины](#2-термины)
- [3. Частота запусков](#3-частота-запусков)
- [4. Быстрый детерминированный аудит](#4-быстрый-детерминированный-аудит)
- [5. Недельный LLM-семантический аудит](#5-недельный-llm-семантический-аудит)
- [6. Запуск недельного аудита](#6-запуск-недельного-аудита)
- [7. Статус и уведомления в редакторе](#7-статус-и-уведомления-в-редакторе)
- [8. Candidate record](#8-candidate-record)
- [9. Suppression](#9-suppression)
- [10. Promotion backlog](#10-promotion-backlog)
- [11. Проверки перед созданием прототипа](#11-проверки-перед-созданием-прототипа)
- [12. Команды](#12-команды)

## 1. Назначение

Регулярный аудит нужен, чтобы повторяющиеся game/UI authoring-элементы находились до того, как копии станут дорогими в поддержке. Аудит не применяет изменения и не создает прототипы автоматически. Его результат - список кандидатов, объяснение риска, suppression records и задачи на ручной review.

Процесс разделяет две воронки:

1. `authoring nodes -> game-level prototype candidate`;
2. `existing local prototypes -> platform-level promotion candidate`.

Это разделение защищает платформу от преждевременного обобщения: локальный прототип может быть полезен конкретной игре, но не обязан становиться общим прототипом Cubica.

## 2. Термины

- **Authoring manifest** - редактируемый JSON-манифест игры или UI, где разрешены authoring-only ключи вроде `_definitions`, `_type`, `_extends`, `_semantics`, `_prompt` и `_promptTemplate`.
- **Детерминированный аудит** - автоматический поиск повторов по структуре JSON, нормализации и численным порогам без обращения к языковой модели.
- **LLM-семантический аудит** - редкий аудит с LLM (Large Language Model, большая языковая модель), которая ищет смысловые повторы даже там, где JSON-форма отличается.
- **Candidate record** - запись о найденном кандидате: source pointers, score, объяснение, риск, рекомендуемое действие и проверочные gates.
- **Suppression** - явное подавление кандидата с причиной, владельцем и датой пересмотра.
- **Promotion backlog** - очередь локальных прототипов и кандидатов, которые проверяющий рассматривает для возможного повышения до platform-level prototype.
- **CI** - Continuous Integration, автоматические проверки репозитория на событиях вроде Pull Request или расписания.
- **PR** - Pull Request, запрос на внесение изменений в основную ветку репозитория.
- **Default branch** - основная ветка репозитория, с которой выполняется недельный scheduled workflow.
- **Scheduled workflow** - workflow GitHub Actions, который запускается по расписанию через cron-выражение.

## 3. Частота запусков

| Запуск | Что выполняется | Блокирует ли разработку | Результат |
| --- | --- | --- | --- |
| Ручной запуск в редакторе | Детерминированный аудит текущего файла или игры | Нет | Кандидаты и кнопка подготовки proposal. |
| Pull Request или push в PR-ветку | Детерминированный аудит только измененных authoring-файлов | Сначала нет; позже мягкая блокировка для новых кандидатов с высокой уверенностью | PR-отчет или CI artifact. |
| Недельный запуск на default branch | Полный детерминированный аудит всех authoring-файлов | Нет | Weekly audit report. |
| Недельный LLM-семантический аудит | Проверка смысловых повторов по compact context | Нет | Semantic candidate records. |
| Недельный promotion backlog review | Ручная классификация локальных прототипов и кандидатов | Нет | Promotion requests или решения `game-specific`/`not-ready`. |
| Перед крупной миграцией | Детерминированный и LLM-аудит выбранной игры/канала | По решению task owner | Task artifact с baseline и рисками. |

PR-аудит не должен запускать LLM по умолчанию. Он должен быть быстрым, дешевым и воспроизводимым. Недельный LLM-аудит выполняется реже, потому что он ищет смысловые совпадения и требует review, но не должен задерживать обычные PR.

## 4. Быстрый детерминированный аудит

Детерминированный аудит использует структурное сравнение authoring-узлов:

- группирует JSON-объекты по normalized shape;
- игнорирует known-variant поля вроде `id`, `_label`, `_prompt`, `_semantics`, `text`, `title`, координат и action ids;
- сохраняет stable discriminator поля вроде `_type`, `type`, `kind`, `handler`, `templateId`, `component`, `layout`;
- считает repetition count, common field count, override field count, shared field ratio, readability risk и over-extraction risk;
- исключает `_definitions`, чтобы не предлагать извлекать уже созданные прототипы как новые source instances.

Рекомендованный high-confidence сигнал для локального прототипа:

- `repetitionCount >= 3` или два крупных стабильных узла;
- `sharedFieldRatio >= 0.55`;
- override-поля не больше общего тела прототипа;
- источники не смешивают разные `_type`;
- ожидаемый runtime diff равен нулю;
- source map pointers после dry-run остаются валидными.

На PR детерминированный аудит должен смотреть только измененные `games/*/authoring/**/*.json`. Полный scan всех игр относится к недельному отчету.

## 5. Недельный LLM-семантический аудит

LLM-семантический аудит нужен потому, что структурный поиск может пропустить смысловые дубли. Примеры:

- два UI-блока имеют разную структуру, но одинаковую роль для игрока;
- web и telegram UI выражают один и тот же intent разными компонентами;
- game actions используют разные эффекты, но решают одну методическую задачу;
- локальные прототипы в разных играх называются по-разному, но описывают один общий паттерн.

LLM получает compact context (сжатый контекст только из нужных authoring-узлов), а не полный runtime state:

- source pointers;
- `_label`, `_semantics`, `_prompt`, `_promptTemplate`;
- normalized summary выбранных JSON-узлов;
- краткое описание игры, канала и authoring file kind;
- результат последнего deterministic scan;
- уже существующие локальные прототипы и их use cases.

LLM возвращает только semantic candidate records. Он может предложить:

- группы смыслово похожих элементов;
- объяснение общего намерения;
- предполагаемые параметры;
- классификацию `local-only`, `local-prototype-candidate` или `platform-promotion-candidate`;
- риск ложного совпадения;
- список deterministic checks, которые нужно выполнить.

LLM не может:

- применять `EditorChangeSet`;
- писать `_definitions`;
- менять platform-level catalog;
- обходить JSON Schema validation, compiler dry-run, canonical runtime diff, source-map checks или manual approval.

## 6. Запуск недельного аудита

Недельный аудит запускается вне редактора через GitHub Actions workflow на default branch. Редактор показывает состояние и может дать ссылку/действие для ручного перезапуска, но не является планировщиком недельного процесса.

Реализованный workflow:

- `schedule` - основной недельный запуск, например в понедельник ночью по UTC не в начале часа, чтобы снизить риск задержек на стороне GitHub Actions;
- `workflow_dispatch` - ручной запуск полного audit с параметрами `mode` и `includeLlm`, если нужно перезапустить audit после сбоя;
- `pull_request` - отдельный быстрый deterministic режим только для измененных authoring-файлов.

Рекомендуемый порядок недельного workflow:

1. Checkout последнего commit default branch.
2. Установка Node/npm зависимостей.
3. Полный deterministic scan всех `games/*/authoring/**/*.json`.
4. Генерация deterministic candidate records.
5. Подготовка compact context для LLM-семантического аудита.
6. LLM-семантический audit, если доступен настроенный provider и разрешен недельный режим.
7. Объединение deterministic и semantic records в weekly report.
8. Обновление audit status record с `lastStartedAt`, `lastCompletedAt`, `status`, `llmStatus`, `reportPath`, commit metadata и summary.
9. Публикация отчета как CI artifact и передача summary в promotion backlog.

GitHub Actions scheduled workflow выполняется на последнем commit default branch. Из-за возможных задержек scheduled jobs редактор не должен считать аудит пропущенным ровно в момент расписания. Нужен grace period: минимум 36 часов после ожидаемого времени запуска.

## 7. Статус и уведомления в редакторе

Редактор должен показывать пользователю состояние недельного аудита, потому что автор игры может долго работать в editor session и не видеть CI-отчеты.

`apps/editor-web` читает audit status record через локальный server route `GET /api/editor/prototype-audit/status`. Сейчас route читает JSON из `PROTOTYPE_AUDIT_STATUS_FILE` или из `.tmp/prototype-audit/status.json` в корне проекта. Будущий persistent home может быть repository audit index или GitHub Actions API adapter; до выбора такого home редактор работает fail open: отсутствие статуса показывает предупреждение, но не блокирует редактирование.

Минимальная форма status record:

```json
{
  "schemaVersion": 1,
  "cadence": "weekly",
  "expectedEveryDays": 7,
  "graceHours": 36,
  "lastStartedAt": "2026-06-08T03:37:00Z",
  "lastCompletedAt": "2026-06-08T03:52:00Z",
  "status": "completed",
  "llmStatus": "completed",
  "branch": "main",
  "commitSha": "abc123",
  "reportPath": ".tmp/prototype-audit/weekly-report.md",
  "summary": {
    "deterministicCandidates": 12,
    "semanticCandidates": 4,
    "promotionCandidates": 2
  }
}
```

Редактор должен показывать уведомление в следующих случаях:

- `missing` - status record отсутствует;
- `stale` - `lastCompletedAt` старше `expectedEveryDays + graceHours`;
- `failed` - последний weekly workflow завершился ошибкой;
- `partial` - deterministic audit завершился, но LLM-семантический audit был пропущен или упал;
- `outdated-report` - отчет есть, но относится к commit, который старше текущего default branch head.

Уведомление должно быть неблокирующим: Save, preview, `EditorChangeSet` и ручной proposal flow продолжают работать. В тексте нужно показать простую причину, дату последнего успешного аудита, ссылку на отчет и действие "Run weekly audit" или "Open audit workflow", если backend умеет открыть `workflow_dispatch` или ссылку на GitHub Actions.

Редактор не должен скрывать предупреждение навсегда. Допустимо "snooze for session" - скрыть уведомление до конца текущей editor session. Постоянное подавление идет только через suppression/process records, а не через локальную кнопку в UI.

## 8. Candidate record

Каждый кандидат должен иметь стабильную запись. Минимальная форма:

```json
{
  "id": "prototype-candidate:<stable-hash>",
  "scope": "game:antarctica/ui:web",
  "source": "deterministic",
  "classification": "local-prototype-candidate",
  "sourcePointers": ["/root/screens/0/components/2", "/root/screens/3/components/2"],
  "score": {
    "repetitionCount": 2,
    "sharedFieldRatio": 0.67,
    "readabilityRisk": "medium",
    "overExtractionRisk": "medium"
  },
  "summary": "Повторяющаяся панель действий с одинаковым layout и разными labels/action ids.",
  "recommendedAction": "review-local-prototype",
  "requiredChecks": [
    "editor-change-set-dry-run",
    "compiler-dry-run",
    "canonical-runtime-diff",
    "source-map-pointer-existence"
  ]
}
```

Идентификатор должен строиться из normalized shape, scope и source kind. Нельзя строить его только из строк файла: номера строк меняются от форматирования и не подходят для истории аудита.

## 9. Suppression

Suppression разрешен, если кандидат является ложным совпадением или прототип ухудшит читаемость. Suppression должен быть явным:

- candidate id;
- причина;
- владелец решения;
- дата создания;
- дата пересмотра;
- ссылка на PR, task artifact или review note.

Постоянное подавление без даты пересмотра запрещено. Если suppression закрывает high-confidence кандидата, причина должна объяснять, почему копии лучше прототипа.

## 10. Promotion backlog

Недельный promotion backlog review смотрит не только на raw-дубли, но и на существующие game-level prototypes.

Проверяющий классифицирует каждый элемент:

- `general` - можно готовить promotion request;
- `game-specific` - оставить внутри игры;
- `not-ready` - идея может быть общей, но не хватает примеров, параметризации или проверок.

Если принято `general`, дальше применяется процесс `docs/processes/authoring-prototype-promotion.md`. Weekly audit не заменяет promotion checklist и не создает platform-level prototype автоматически.

## 11. Проверки перед созданием прототипа

Перед созданием локального прототипа candidate record должен пройти proposal gates:

```bash
npm run compile:manifests -- --check
npm run verify:manifest-authoring
npm run verify:editor-engine
npm run verify:editor-web
rg -n '"_definitions"|"_type"|"_extends"|"_promptTemplate"|"_prototypeImports"|"_source_trace"' games/*/game.manifest.json games/*/ui/*/ui.manifest.json
git diff --check
```

Ожидаемый результат leakage scan: `rg` не находит authoring-only ключи в generated runtime manifests.

Если canonical runtime diff показывает изменение generated output, это не чистое извлечение прототипа. Такой кандидат должен перейти в отдельную gameplay/UI migration task.

## 12. Команды

CLI поддерживает основные режимы аудита:

```bash
npm run audit:prototype-candidates -- --changed origin/main --mode deterministic
npm run audit:prototype-candidates -- --scope all --mode deterministic --format markdown
npm run audit:prototype-candidates -- --scope all --mode semantic-llm --format markdown
npm run audit:prototype-candidates:weekly
```

LLM-семантический режим использует внешнюю команду из `PROTOTYPE_AUDIT_LLM_COMMAND`. CLI передает compact context в stdin и ожидает JSON с массивом `candidates` в stdout. Если команда не настроена, weekly audit завершается успешно, но `llmStatus` становится `skipped`, а редактор показывает `partial`.

CI workflow имеет:

- `pull_request` trigger для changed-file deterministic audit;
- `workflow_dispatch` trigger для ручного полного запуска с выбором режима и LLM-части;
- `schedule` trigger для недельного полного audit на default branch.

Scheduled workflow в GitHub Actions выполняется на последнем commit default branch, поэтому недельный audit должен читать именно canonical branch state и сохранять отчет как artifact или task handoff, а не изменять файлы напрямую.
