# Промпты Game Editor

Документ задает правила работы с промтами (prompt - текст или структурированный запрос к LLM) в Game Editor. Он различает временный промт операции редактирования, сохраненный элементный промт из ADR-048 и целевой dynamic element prompt из ADR-049.

## Оглавление

- [1. Общие требования](#1-общие-требования)
- [2. Типы промтов](#2-типы-промтов)
- [3. Жизненный цикл элементного промта](#3-жизненный-цикл-элементного-промта)
- [4. Статусы и поля первого среза](#4-статусы-и-поля-первого-среза)
- [5. Целевой контракт ADR-049](#5-целевой-контракт-adr-049)
- [6. Граница первого среза ADR-048](#6-граница-первого-среза-adr-048)
- [7. Ограничения безопасности](#7-ограничения-безопасности)

## 1. Общие требования

Промт должен быть:

- воспроизводимым: по нему можно понять намерение автора и повторить сценарий правки;
- безопасным: он не включает секреты, персональные данные вне сценария или внутренние токены доступа;
- версионированным: изменения фиксируются через session journal and Git history;
- ограниченным по области: агент получает выбранные элементы, ближайший контекст, схемы и диагностику, а не весь большой манифест без необходимости;
- проверяемым: результат промта превращается в bounded `EditorChangeSet`, проходит dry-run and validation до применения.

## 2. Типы промтов

- `EditorPatchIntent.prompt` - временный запрос на конкретную правку в редакторе. Он хранится в session journal как часть истории изменения.
- `_prompt` - сохраненный элементный промт конкретного authoring-экземпляра. В первом срезе он хранит `raw/normalized`; в целевой архитектуре ADR-049 он хранит только static residue, то есть невосстановимую статическую часть авторского намерения.
- `_promptTemplate` - шаблон промта в authoring-прототипе. Редактор копирует его в новый экземпляр при добавлении элемента.
- `compiled prompt` - единый текст, который видит пользователь: `_prompt.staticText` или шаблонная статическая часть плюс dynamic YAML projection текущего JSON-узла.
- `dynamic YAML projection` - временное YAML-представление authoring JSON-узла с русскими названиями полей; оно не хранится как источник истины.
- `generation.prompt` - промт визуальной генерации design artifact. Он не описывает игровое или UI-поведение и не заменяет `_prompt`.

## 3. Жизненный цикл элементного промта

1. Новый элемент без `_prompt` получает unsaved compiled prompt из `_promptTemplate` и dynamic YAML projection текущего JSON-узла.
2. Если `_prompt` уже есть, редактор показывает его static residue вместе с новой dynamic YAML projection.
3. Пользователь редактирует compiled prompt как единый человеко-читаемый текст.
4. Агент получает compiled prompt, JSON-фрагменты, schema context, field dictionary и projection source map.
5. Агент отделяет static residue от структурных правок.
6. Агент возвращает новый `_prompt.staticText` или external Markdown content и bounded `EditorChangeSet`.
7. Редактор применяет ChangeSet только после dry-run, JSON Schema validation, semantic validation and undo journal recording.
8. После применения dynamic YAML projection пересобирается из JSON.
9. Если структура манифеста меняется без обновления `_prompt`, drift diagnostics помечает промт как `stale` или предлагает repair через `EditorChangeSet`.

Первый реализованный срез уже валидирует `_prompt` и `_promptTemplate`, но пока не добавляет dynamic YAML projection, field dictionary и reverse direction через агента.

## 4. Статусы и поля первого среза

`_prompt.status` принимает:

- `draft` - пользовательский или шаблонный текст еще не нормализован и не подтвержден;
- `normalized` - агент подготовил формулировку, но пользователь еще не подтвердил ее как актуальное описание элемента;
- `confirmed` - пользователь подтвердил нормализованную формулировку.

Для `_prompt` обязательны:

- `status`;
- `raw`;
- `source`;
- `language`;
- `updatedAt`.

Для `status: "normalized"` и `status: "confirmed"` обязательно поле `normalized`.

`_prompt.source` принимает `template`, `user`, `agent`, `imported` или `migration`. `_promptTemplate` содержит `raw`, `language` и опциональный `appliesTo`.

Эти поля остаются фактом реализованного среза. Целевая модель ADR-049 заменяет долгосрочное хранение `raw/normalized` на один static residue и требует отдельной миграции схемы.

## 5. Целевой контракт ADR-049

Целевой `_prompt` хранит только static residue:

```json
{
  "_prompt": {
    "version": 3,
    "status": "confirmed",
    "staticText": "Методический смысл и авторские ограничения, которые не выражены отдельными полями манифеста.",
    "origin": "user",
    "language": "ru",
    "updatedAt": "2026-06-13T00:00:00Z"
  }
}
```

Правила:

- полный compiled prompt не сохраняется;
- dynamic YAML projection всегда пересобирается из JSON;
- русские названия полей берутся из schema annotations и field dictionary;
- словарь полей ключуется контекстом, например schema pointer или `semanticType + relativePath`, а не одним названием свойства;
- обратное преобразование из edited compiled prompt в authoring JSON идет только через агента и `EditorChangeSet`;
- canonical manifests остаются JSON; YAML является только форматом показа в редакторе.

## 6. Граница первого среза ADR-048

Первый срез реализации приводит текущее состояние к принятому контракту `_prompt`/`_promptTemplate`, но сам по себе не выбирает механизм поддержания актуальности промта и структуры. Целевой механизм после первого среза зафиксирован в ADR-049: static residue в `_prompt`, dynamic YAML projection из JSON и reverse direction через агента и `EditorChangeSet`.

В первом срезе нужно:

- добавить поля в authoring-схемы и прототипы;
- научить редактор показывать и валидировать эти поля;
- удалить `_prompt` и `_promptTemplate` из generated runtime manifests;
- сохранить текущий flow `EditorPatchIntent -> EditorChangeSet -> dry-run -> apply/undo/save`.

В первом срезе нельзя:

- автоматически переписывать `_prompt` при изменении структурированных полей;
- генерировать `_prompt` из структуры манифеста как обязательное правило;
- вводить hash/coverage metadata для проверки расхождений;
- считать предупреждение о дрейфе заменой отдельного механизма синхронизации.

## 7. Ограничения безопасности

- Агент не может считать пользовательское подтверждение обычным аргументом модели. Подтверждение должно приходить из UI workflow Cubica.
- Агент не может переписывать весь файл, если достаточно ChangeSet, ограниченного выбранными JSON Pointer.
- Сохраненный `_prompt` не должен попадать в generated runtime manifests без отдельного runtime-контракта.
- Промт не является исполняемой логикой. Исполнение остается в structured manifest fields, validated JSON Schema and runtime handlers.
- YAML-проекция не является источником истины и не может применяться к JSON без агента, source map, dry-run and validation.
