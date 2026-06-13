# ADR-050: Authoring Prototype Extraction And Promotion

- **Дата**: 2026-06-13
- **Статус**: Accepted
- **Авторы**: Codex
- **Компоненты**: Authoring manifests, UI authoring manifests, Game Editor, editor-engine, authoring compiler, manifest schemas
- **Связанные решения**: ADR-025, ADR-030, ADR-034, ADR-036, ADR-040, ADR-048, ADR-049

## Оглавление

- [1. Понимание решения](#1-понимание-решения)
- [2. Контекст](#2-контекст)
- [3. Термины](#3-термины)
- [4. Принятое решение](#4-принятое-решение)
- [5. Вариант A: локальное извлечение прототипов](#5-вариант-a-локальное-извлечение-прототипов)
- [6. Вариант B: двухуровневые прототипы и ручное повышение](#6-вариант-b-двухуровневые-прототипы-и-ручное-повышение)
- [7. Вариант D: AI-assisted prototype designer](#7-вариант-d-ai-assisted-prototype-designer)
- [8. Архитектурные инварианты](#8-архитектурные-инварианты)
- [9. Критерии повышения в платформенный прототип](#9-критерии-повышения-в-платформенный-прототип)
- [10. Валидация и source maps](#10-валидация-и-source-maps)
- [11. Регулярный аудит кандидатов](#11-регулярный-аудит-кандидатов)
- [12. Отклоненная альтернатива](#12-отклоненная-альтернатива)
- [13. Последствия](#13-последствия)
- [14. Открытые вопросы](#14-открытые-вопросы)
- [15. Связанные практики](#15-связанные-практики)

## 1. Понимание решения

Решение понято так: Cubica принимает механизм, который помогает находить часто повторяющиеся элементы game/UI authoring-манифестов и выносить их в authoring-прототипы. При этом прототип сначала должен появляться на уровне конкретной игры, а только после проверки пользы и универсальности может стать платформенным прототипом.

Принимаются три направления:

- **Вариант A** - локальное извлечение прототипов внутри конкретной игры.
- **Вариант B** - двухуровневая модель: game-level prototype и platform-level prototype с ручным повышением.
- **Вариант D** - AI-assisted designer, где ИИ помогает предложить прототип, параметры и миграцию, но изменения проходят через обычный Cubica `EditorChangeSet`.

Полностью автоматическое повышение локального прототипа до платформенного не принимается.

## 2. Контекст

ADR-030 ввел authoring-прототипы как reusable definitions в `_definitions`. ADR-036 уточнил authoring v2: реальные game/UI сущности живут в `root`, а `_definitions` остаются реестром переиспользуемых прототипов. ADR-048 добавил `_promptTemplate` для прототипов, а ADR-049 уточняет dynamic element prompts, YAML projection, field dictionary и drift diagnostics.

Текущая проблема:

1. UI-манифесты и game authoring-файлы содержат повторяющиеся экраны, кнопки, карточки, панели метрик, actions и effects.
2. Ручное копирование делает изменения дорогими и создает риск незаметного расхождения между похожими элементами.
3. Без механизма повышения локальные удачные решения не становятся платформенными reusable building blocks.
4. Слишком раннее автоматическое обобщение может протащить game-specific паттерны в платформенный слой.

Внешняя практика JSON Schema поддерживает ту же базовую идею: повторяемые структуры нужно выносить в именованные definitions и ссылаться на них через явные identifiers/references, а не дублировать вручную. Для Cubica это означает: reusable authoring-прототипы должны быть явными, валидируемыми и не должны становиться скрытым runtime-контрактом.

## 3. Термины

- **Game-level prototype** - authoring-прототип, принадлежащий конкретной игре. Он может знать предметную область игры, локальные названия, локальные метрики и локальные UI-паттерны.
- **Platform-level prototype** - authoring-прототип платформы Cubica. Он не знает конкретную игру и задает общий паттерн для класса игр, экранов, действий или UI-компонентов.
- **Извлечение прототипа** - преобразование повторяющихся authoring-узлов так, что общие поля переезжают в `_definitions`, а экземпляры оставляют только `_type` и отличающиеся параметры.
- **Повышение прототипа** - перенос проверенного game-level prototype в платформенный каталог после ручного архитектурного решения.
- **Параметр прототипа** - поле, которое остается в экземпляре и переопределяет или дополняет общее поведение прототипа.
- **Нулевая runtime-разница** - результат компиляции authoring-манифеста до и после извлечения прототипа совпадает по runtime-смыслу. Для безопасного первого режима это должен быть byte-level или canonical JSON diff без изменений.
- **Детерминированный аудит** - повторяемый автоматический поиск кандидатов по структуре JSON, правилам нормализации и численным порогам без обращения к LLM.
- **LLM-семантический аудит** - более редкая проверка, где LLM (Large Language Model, большая языковая модель) ищет смысловые повторы, которые могут не совпадать по форме JSON.
- **Suppression** - явное подавление конкретного кандидата с причиной и сроком пересмотра, чтобы регулярный отчет не превращался в постоянный шум.
- **PR** - Pull Request, запрос на внесение изменений в основную ветку репозитория.

## 4. Принятое решение

Cubica принимает поэтапную архитектуру прототипов:

1. Любое автоматическое или полуавтоматическое извлечение начинается с локального game-level prototype.
2. Platform-level prototype появляется только после ручного повышения и проверки универсальности.
3. Инструмент извлечения сначала строит proposal: список повторов, общий prototype body, параметры экземпляров, affected JSON Pointers и ожидаемый runtime diff.
4. Применение proposal идет только через `EditorChangeSet`, dry-run, JSON Schema validation, semantic validation, compile check и undo journal.
5. AI-assisted designer может предлагать названия, `_semantics`, `_promptTemplate`, параметры и миграцию, но не применяет изменения напрямую.
6. Runtime manifests не получают `_definitions`, `_type`, `_extends`, `_promptTemplate`, import metadata или source trace.
7. Поиск кандидатов становится регулярным: быстрый детерминированный аудит работает на PR/измененных файлах, а недельный аудит объединяет полный детерминированный scan, LLM-семантический аудит и promotion backlog review.

## 5. Вариант A: локальное извлечение прототипов

Вариант A принят как первый безопасный уровень.

Локальный extractor ищет повторяющиеся authoring-узлы внутри одной игры или одного authoring-файла:

- UI screen shells, например topbar/left-sidebar layout;
- панели метрик и повторяющиеся metric variables;
- типовые кнопки `requestServer`, `showHint`, `showHistory`, navigation controls;
- карточки с одинаковой структурой и разными текстами/action ids;
- game actions с одинаковым handler/template/effects shape.

Extractor должен сравнивать normalized structure, а не сырой JSON. Нормализация может временно исключать поля `id`, `_label`, `_semantics`, `_prompt`, тексты, координаты или другие known-variant fields, если это явно отражено в proposal.

Принятый результат варианта A:

```json
{
  "_definitions": {
    "ui.AntarcticaTopbarScreen": {
      "_semantics": "Локальная оболочка topbar-экрана Antarctica.",
      "_promptTemplate": {
        "raw": "Опишите назначение topbar-экрана, главный контент, действия и метрики.",
        "language": "ru",
        "appliesTo": "ui.AntarcticaTopbarScreen"
      }
    }
  },
  "root": {
    "screens": [
      {
        "_type": "ui.AntarcticaTopbarScreen",
        "id": "i20",
        "_label": "Экран i20",
        "title": "..."
      }
    ]
  }
}
```

Локальный prototype может оставаться game-specific. Это не нарушение архитектуры, пока он не попадает в platform catalog и не требует runtime branches.

## 6. Вариант B: двухуровневые прототипы и ручное повышение

Вариант B принят как целевая модель.

Уровни:

1. **Game-level registry** - `_definitions` внутри `games/<gameId>/authoring/**`.
2. **Platform-level catalog** - будущий authoring-only каталог общих прототипов Cubica.

Platform-level catalog должен быть отдельным authoring/tooling слоем. Он не должен жить в `runtime-api`, `player-web` или runtime contracts как исполнимая логика. Возможный будущий home:

```text
packages/authoring-prototypes/
  game/
  ui/
  examples/
  tests/
```

Пока физический home не реализован, ADR фиксирует границу: platform-level prototypes являются authoring-only input для компилятора и редактора.

Локальный прототип может расширять платформенный через `_extends`, если compiler/schema поддерживают явный импорт:

```json
{
  "_prototypeImports": [
    {
      "source": "platform",
      "version": "1.0.0",
      "include": ["ui.PrimaryActionButton", "ui.MetricBar"]
    }
  ],
  "_definitions": {
    "ui.AntarcticaMetricBar": {
      "_extends": "ui.MetricBar",
      "_semantics": "Локальная панель метрик Antarctica с предметными названиями показателей."
    }
  }
}
```

`_prototypeImports` в этом ADR является направлением контракта, а не требованием к уже существующей реализации. Если поле будет добавлено, оно должно быть authoring-only и удаляться из generated runtime manifests.

## 7. Вариант D: AI-assisted prototype designer

Вариант D принят как вспомогательный слой поверх A и B.

ИИ-агент может:

- найти группы похожих элементов;
- предложить имя прототипа;
- отделить общие поля от параметров;
- предложить `_semantics` и `_promptTemplate`;
- классифицировать прототип как game-specific или candidate-for-platform;
- сформировать plain-language diff summary;
- предложить `EditorChangeSet`.

ИИ-агент не может:

- применять изменения без Cubica approval envelope;
- повышать прототип до platform-level без ручного архитектурного решения;
- создавать runtime-specific branches;
- объявлять game-specific механику платформенной только на основании одного использования;
- обходить JSON Schema validation или compiler checks.

Вывод AI-assisted designer проходит существующий путь:

```text
assistant suggestion -> EditorChangeSet -> dry-run -> schema/semantic validation -> compile check -> user approval -> apply
```

## 8. Архитектурные инварианты

- Runtime layer не резолвит authoring-прототипы.
- Generated runtime manifests не содержат authoring-only ключи, import metadata или prompt templates.
- JSON Schema остается source of truth для authoring и runtime structures.
- Platform-level prototype не может содержать concrete game id, screen id, local metric id, локальные тексты, asset paths или правила, осмысленные только для одной игры.
- Game-level prototype может быть game-specific, но должен оставаться внутри game bundle.
- Authoring prototypes не заменяют ADR-028 runtime action templates. Они могут генерировать runtime actions с `templateId` и `params`, но не становятся вторым runtime action model.
- Любая новая runtime-семантика идет через JSON Schema, contracts и reusable handlers по ADR-040.
- Source maps должны указывать на существующие authoring pointers после извлечения прототипов.
- Prototype extraction не должен ухудшать возможность редактирования элемента в property panel, JSON tree и preview selection flow.
- Over-extraction запрещен: прототип нужен только для повторяемого и устойчивого паттерна, а не для каждого похожего узла.

## 9. Критерии повышения в платформенный прототип

Локальный прототип может стать platform-level prototype только если выполняются все условия:

1. У прототипа есть минимум два независимых use case или один use case, явно относящийся к целому классу игр.
2. Game-specific поля вынесены в параметры или удалены.
3. Есть `_semantics`, объясняющий общий смысл.
4. Есть `_promptTemplate`, если прототип предназначен для создания или уточнения authoring-элементов через редактор.
5. Есть schema example для game или UI authoring.
6. Есть compiler/validation coverage, подтверждающий отсутствие authoring-only leakage.
7. Есть migration guidance для локальных пользователей прототипа.
8. Есть versioning policy: breaking changes требуют новой версии или явной migration.
9. Архитектурная классификация "general vs game-specific" записана в ADR, architecture doc или task artifact before promotion.

## 10. Валидация и source maps

Prototype extraction proposal должен показывать:

- source pointers повторяющихся узлов;
- proposed definition pointer;
- поля, которые станут параметрами;
- expected runtime diff;
- source map impact;
- список validation gates.

Минимальные gates для accepted extraction:

- authoring JSON Schema validation;
- compiler dry-run;
- generated runtime manifest validation;
- authoring-only key leakage scan;
- source map pointer existence check;
- runtime diff check, по умолчанию нулевая runtime-разница;
- semantic diagnostics for missing `_label`, `_semantics` and invalid `_promptTemplate`;
- editor dry-run with inverse ChangeSet.

Если extraction намеренно меняет runtime output, это уже не "чистое извлечение прототипа" и должно быть оформлено как отдельная gameplay/UI migration, а не как автоматическая дедупликация.

## 11. Регулярный аудит кандидатов

Регулярный аудит принят как часть governance для ADR-050. Он не применяет изменения, не создает `_definitions` сам по себе и не повышает локальные прототипы в платформенный каталог. Его результат - candidate records, отчеты, suppression records и promotion requests.

Принятая частота:

| Запуск | Что выполняется | Назначение |
| --- | --- | --- |
| Ручной запуск в редакторе | Детерминированный аудит текущего файла или игры | Быстро показать автору локальные кандидаты и подготовить proposal. |
| PR или push в PR-ветку | Детерминированный аудит измененных `games/*/authoring/**/*.json` | Сначала предупреждающий отчет, затем возможная мягкая блокировка только для новых кандидатов с высокой уверенностью без suppression. |
| Недельный запуск на default branch | Полный детерминированный аудит всех authoring-файлов | Обновить backlog локальных кандидатов и найти повторы между файлами и каналами. |
| Недельный LLM-семантический аудит | LLM проверяет compact authoring context, `_prompt`, `_semantics`, `_label`, source pointers и summaries | Найти смысловые повторы, которые структурный алгоритм мог пропустить. |
| Недельный promotion backlog review | Ручная проверка локальных прототипов и LLM/deterministic кандидатов | Решить, какие локальные прототипы готовы к заявке на platform-level prototype. |

PR-аудит не должен запускать LLM по умолчанию. Он должен быть быстрым, воспроизводимым и пригодным для CI. Недельный LLM-аудит не блокирует PR: он создает review backlog и требует последующей проверки через deterministic proposal gates.

Недельный аудит запускается через CI scheduled workflow на default branch. Workflow должен также поддерживать ручной `workflow_dispatch` для перезапуска после сбоя. Редактор не является планировщиком weekly audit, но должен показывать статус последнего weekly run и предупреждать автора, если аудит отсутствует, просрочен, завершился ошибкой или прошел только частично.

LLM-семантический аудит может предлагать:

- группы смыслово похожих элементов;
- объяснение общего намерения;
- предполагаемые параметры;
- классификацию `local-only`, `local-prototype-candidate` или `platform-promotion-candidate`;
- риск ложного совпадения;
- список обязательных deterministic checks.

LLM-семантический аудит не может:

- применять `EditorChangeSet`;
- записывать `_definitions`;
- повышать прототип до platform-level;
- обходить runtime diff, source-map checks, JSON Schema validation или manual approval.

Candidate record для регулярного аудита должен иметь стабильный идентификатор, основанный на normalized shape, scope и source kind, а не на строках файла. Это позволяет отслеживать кандидата между запусками и привязывать suppression. Suppression должен содержать причину, владельца и дату пересмотра; постоянное молчаливое подавление кандидатов запрещено.

Editor notification invariant: пропущенный weekly audit не блокирует редактирование, preview, save или ручное создание proposal, но должен быть видимым неблокирующим предупреждением в editor surface. Уведомление должно показывать последнее успешное время аудита, статус LLM-части, ссылку на отчет или workflow и действие для ручного перезапуска, если backend это поддерживает.

## 12. Отклоненная альтернатива

**Вариант C: полностью автоматическое повышение в платформенный прототип** отклонен.

Причины:

- один game-specific паттерн может выглядеть общим из-за поверхностного structural similarity;
- автоматическое повышение нарушает правило platform purity over game-specific hacks;
- platform-level prototype становится частью authoring platform API и требует versioning, examples, tests and migration policy;
- ошибочное повышение создает долговременный архитектурный долг сильнее, чем локальное дублирование.

## 13. Последствия

Положительные эффекты:

- повторяющиеся UI/game patterns становятся явными;
- редактор и ИИ-агент получают более компактные authoring deltas;
- успешные локальные решения получают понятный путь к platform reuse;
- runtime layer остается простым и не получает authoring-only логику;
- `_promptTemplate` становится реально полезным стартовым интерфейсом для создания элементов.

Риски и долг:

- нужен tooling для поиска повторов, normalized comparison и proposal review;
- нужен отдельный audit/reporting слой, чтобы PR-аудит, недельный LLM-аудит и promotion backlog не смешивались с apply-flow редактора;
- нужен editor-facing audit status record, иначе автор не увидит пропущенный или частично выполненный недельный аудит изнутри редактора;
- нужен будущий platform-level catalog и import contract;
- source maps становятся критичнее после извлечения прототипов;
- слишком агрессивная дедупликация может ухудшить читаемость authoring-файла;
- LLM-семантический аудит может давать ложные совпадения; он должен оставаться источником кандидатов, а не источником изменений;
- требуется процесс владения и версионирования платформенных прототипов.

## 14. Открытые вопросы

- Где физически разместить platform-level prototype catalog.
- Какой формат `_prototypeImports` принять в JSON Schema.
- Какие thresholds использовать для automatic duplicate detection и когда переводить PR-аудит из advisory mode в soft gate.
- Как показывать prototype parameters в property panel без перегруза автора.
- Нужна ли отдельная deprecation policy для platform-level prototypes.
- Как учитывать cross-channel promotion: например, общий UI prototype для Web и Telegram или отдельные platform prototypes на канал.
- Где хранить suppression records и weekly audit history: task artifacts, future catalog metadata или отдельный audit index.
- Какой compact context считать достаточным для недельного LLM-семантического аудита без передачи лишнего runtime/player state.

## 15. Связанные практики

- JSON Schema structuring: reusable definitions and references reduce duplication in non-trivial JSON models and require stable identifiers for cross-document references. Cubica follows the same idea, but keeps authoring prototypes outside runtime manifests: <https://json-schema.org/understanding-json-schema/structuring>.
- Storybook args: common component defaults plus per-instance overrides are a useful analogy for prototype defaults plus authoring instance parameters. Cubica adopts the pattern conceptually, not Storybook as a dependency: <https://storybook.js.org/docs/writing-stories/args>.
- Design Tokens Format Module: named reusable design decisions should stay platform-neutral and explicit. Cubica applies this as an authoring/tooling principle for platform-level UI prototypes: <https://www.designtokens.org/tr/drafts/format/>.
