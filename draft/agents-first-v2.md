# AGENTS.md — подход agents-first
## Оглавление
- [1) Иерархия AGENTS.md и приоритеты](#1-иерархия-agentsmd-и-приоритеты)
- [2) Где что хранить и чем руководствоваться](#2-где-что-хранить-и-чем-руководствоваться)
- [3) Лёгкий формат «Context-pack» (бриф исполнителю)](#3-лёгкий-формат-context-pack-бриф-исполнителю)
  - [Схема pack](#схема-pack)
  - [Примеры](#примеры)
  - [Связь с задачами и обновление](#связь-с-задачами-и-обновление)
- [4) ADR — когда нужен и как оформить](#4-adr--когда-нужен-и-как-оформить)
- [5) Где и как обновлять документацию](#5-где-и-как-обновлять-документацию)
- [6) Pre-commit / Pre-merge чек‑лист (обязательно)](#6-pre-commit--pre-merge-чек‑лист-обязательно)
  - [Pre-commit / Pre-merge Checklist](#pre-commit--pre-merge-checklist)
- [7) Автоматические проверки в CI (рекомендуется)](#7-автоматические-проверки-в-ci-рекомендуется)
- [8) Консенсус: где истина](#8-консенсус-где-истина)
- [9) Мини‑ритуал для старта новой задачи](#9-мини‑ритуал-для-старта-новой-задачи)



Этот документ описывает, как мы используем AGENTS.md и сопутствующие артефакты. Всё, что нужно для исполнения, — рядом с кодом и открывается из репозитория. Подробные справочники и объяснения — в `README.md` и `docs/**`. В AGENTS.md оставляем только то, что ускоряет работу и не дублирует доки.

---

## 1) Иерархия AGENTS.md и приоритеты

- В корне репозитория хранится общий, краткий и стабильный **AGENTS.md**.
- В каждую подсистему/сервис допускается класть локальный **AGENTS.md** (например, `services/router/AGENTS.md`).
- Правило близости: ориентируемся на **ближайший** AGENTS.md; при конфликте приоритет у локального.
- Объяснения, примеры, команды и версии — в `README.md` или `docs/**`. В AGENTS.md — ссылки и краткая практическая часть.

Мини‑пример локального `AGENTS.md`:

```md
# AGENTS.md (для сервиса `services/router`)

## Scope
- Разрешено: правки кода/тестов в `services/router/**`, обновление локальной документации в `services/router/docs/**`.
- Вне scope: общие CI/CD, платформенные темы, операционные инструкции.

## Якоря ссылок
- Быстрый старт/запуск → ../../README.md#quick-start
- Тесты/линтеры → ../../README.md#testing
- Архитектура модуля → ../../docs/architecture/README.md
- Стиль кода → services/router/DEV_GUIDE.md

## Размещение артефактов
- New code → `services/router/src/**`
- Tests → `services/router/tests/**`
- Обнови разделы `services/router/docs/CHANGELOG.md`, `services/router/docs/DEV_NOTES.md` при необходимости.
```

---

## 2) Где что хранить и чем руководствоваться

- **README.md** — вход для новичка: обзор, установка, запуск, тестирование, contribution.
- **docs/** — how-to, reference, ADR, архитектура и процессы.
- **AGENTS.md** — минимальная «операционка» для быстрого старта: краткий контекст, ссылки и чек‑листы, без дублирования README/docs.

Ссылочные разделы (чтобы не раздувать README):

- Quick start & environment → `README.md#quick-start`
- Tests & CI → `README.md#testing`
- Repo structure → `README.md#repo-structure`
- Coding style → `services/<svc>/DEV_GUIDE.md`
- Architecture overview → `docs/architecture/README.md`
- ADR index → `docs/architecture/adrs/`

---

## 3) Лёгкий формат «Context-pack» (бриф исполнителю)

Назначение: короткий «бриф для запуска» агента. Пак аггрегирует контекст исполнения, но не дублирует содержание задач (истина — в задачах).

- Где хранить: `docs/context-packs/` (формат: YAML)
- Идентификаторы задач: M/E/F (`M-25-01`, `E-25-0001`, `F-25-0101`). См. `docs/tasks/README.md`.
- Именование файлов:
  - Одна задача → `CP-YY-XXX-<kebab>-(<TASK_ID>).yaml`
  - Несколько задач → `CP-YY-XXX-<kebab>.yaml` (ID в имя не добавляем)

### Схема pack

```yaml
id: CP-25-001
title: "<краткое название>"
tasks: [E-25-0001]              # один или несколько ID (M/E/F)
role: implementer|reviewer|tester|migrator
scope:
  code: ["services/**", "scripts/**"]
  docs: ["README.md", "docs/**"]
links:
  tasks:
    - "docs/tasks/epics/E-25-0001-*.md"
  related:
    - "docs/architecture/README.md"
tools:
  - name: shell
    allowed: [read, write, run]
    dirs: ["services/**", "scripts/**", "docs/**"]
  - name: git
    allowed: [status, diff, commit]
  - name: docker
    allowed: [build, run]
# Не дублируем Acceptance/DoD — они в задачах
guardrails:
  - "Не менять публичные API без RFC/ADR"
  - "Покрыть ключевые сценарии тестами"
outputs_expected:
  - "Код, тесты, краткая заметка в ADR (при необходимости)"
status: draft|ready|archived
```

### Примеры

- Один эпик (ID в имени): `docs/context-packs/CP-25-001-editor-mvp-(E-25-0001).yaml`

```yaml
id: CP-25-001
title: "Editor MVP — исполнение"
tasks: [E-25-0001]
role: implementer
scope:
  code: ["services/editor/**"]
  docs: ["docs/architecture/**", "services/editor/DEV_GUIDE.md"]
links:
  tasks:
    - "docs/tasks/epics/E-25-0001-editor-mvp.md"
  related:
    - "docs/architecture/README.md"
    - "docs/architecture/adrs/"
tools:
  - name: shell
    allowed: [read, write, run]
    dirs: ["services/editor/**", "docs/**"]
  - name: git
    allowed: [status, diff, commit]
outputs_expected:
  - "Рабочий MVP + тесты"
status: ready
```

- Несколько задач (ID в имени не добавляем): `docs/context-packs/CP-25-002-auth-session.yaml`

```yaml
id: CP-25-002
title: "Router auth + session"
tasks: [E-25-0001, F-25-0101]
role: implementer
scope:
  code: ["services/router/**", "services/auth/**"]
  docs: ["docs/architecture/**", "services/**/DEV_GUIDE.md"]
links:
  tasks:
    - "docs/tasks/epics/E-25-0001-editor-mvp.md"
    - "docs/tasks/features/F-25-0101-router-auth.md"
  related:
    - "docs/architecture/adrs/"
tools:
  - name: shell
    allowed: [read, write, run]
    dirs: ["services/router/**", "services/auth/**", "docs/**"]
  - name: git
    allowed: [status, diff, commit]
outputs_expected:
  - "Код + тесты + краткая ADR‑заметка"
status: draft
```

### Связь с задачами и обновление

- Источник правды: задачи в `docs/tasks/` (Milestone/Epic/Feature). В них — статусы, Acceptance Criteria, Definition of Done, ссылки.
- В pack не переносим Acceptance/DoD/статус задачи. Держим только операционные настройки (роль, инструменты, область).
- При работе по pack:
  1) Обновляйте статусы соответствующих задач (`planned|in_progress|review|done|dropped`).
  2) В задачах отмечайте чек‑листы и DoD; добавляйте ссылки на PR/ADR.
  3) В pack при необходимости обновляйте `tools`, `scope`, `links` и `status` (`draft|ready|archived`).
  4) Для мультизадачных pack обновляйте каждую задачу из `tasks: [...]`.
- Быстрые ссылки по задачам: см. раздел «Поиск и обзор прогресса» в `docs/tasks/README.md`.
## 4) ADR — когда нужен и как оформить

ADR обязателен для архитектурных, кросс‑сервисных и Backward‑incompatible изменений.

- Шаблон: `docs/architecture/adrs/000-template.md`
- Размещение: `docs/architecture/adrs/NNN-your-title.md` (NNN — номер с ведущими нулями)

Если ADR не нужен (мелкая правка/рефакторинг без изменения контрактов) — это допустимо, всё равно обновите соответствующие docs.

---

## 5) Где и как обновлять документацию

При изменениях поддерживаем актуальность минимум в трёх местах (если применимо):

Структура ссылок:

```
docs/architecture/<svc>.md      # reference для сервиса/компонента
docs/architecture/<topic>.md    # параметры конфигов/API/CLI
docs/processes/<recipe>.md      # процедура, если нужна
docs/tasks/*                    # ROADMAP.md, вехи, эпики, фичи
```

Скелет reference‑страницы:

```md
### <Topic> - Reference
#### Компоненты/сервисы
...

#### Параметры
<!-- и т.п.; ссылки на README#configuration -->

#### Нефункциональные требования (NFR)
...

#### См. также
- ADR: NNN-<title> (если есть)
- How-to: ../../processes/<recipe>.md
```

---

## 6) Pre-commit / Pre-merge чек‑лист (обязательно)

Ниже приведён глобальный чек-лист.

Мини‑версия под задачу:

```md
### Pre-commit / Pre-merge Checklist

- [ ] Код и тесты лежат в `services/<svc>/src|tests`
- [ ] Обновлены docs: reference/how-to/architecture (и ADR при необходимости)
- [ ] ADR в актуальном статусе: Draft/Accepted/Rejected/Deprecated
- [ ] Context-pack отмечен: status=archived; добавлены summary и ссылки на PR/ADR
- [ ] Есть .env.example (без секретов) + ссылка в README#configuration
- [ ] Нет секретов/ключей в коде/репозитории
- [ ] Сообщение коммита/PR осмысленное (`feat|fix|docs(scope): msg`)
- [ ] CI зелёный
```

В корневом `AGENTS.md` оставьте ссылку на этот чек‑лист и требование пройти его перед коммитом/PR.

---

## 7) Автоматические проверки в CI (рекомендуется)

- lint-agents: убеждается, что в `AGENTS.md` нет «живых» команд/версий; только ссылки на README/docs.
- cross-links: валидирует якоря/пути из `AGENTS.md` и context‑packs.
- secrets-scan: нет секретов/токенов в коде/истории; проверяет, что заполнены `.env.example` и `README.md#configuration`.
- docs-sync: базовые smoke‑проверки, что меняемые интерфейсы отражены в релевантных docs‑разделах.

---

## 8) Консенсус: где истина

- Сначала «смысл», потом «как»: AGENTS.md и контент‑пак ускоряют исполнение; задачи и ADR фиксируют решения и результаты.

Единый источник правды по объектам
- Задачи (`docs/tasks/`): Milestone/Epic/Feature с фронтматтером (id, title, status, owner, milestone/parent, area, tags, links) и телом (Scope, In/Out, Stories/Tasks, Acceptance Criteria, DoD). Здесь живут статусы прогресса и чек‑листы качества.
- ADR: архитектурные решения, мотивация, последствия. Не хранит статусы выполнения задач или DoD — только «почему так» и принятые решения.
- Контент‑пак: бриф исполнения (role, tools, scope globs, links), может ссылаться на несколько задач. Не дублирует Acceptance/DoD/статусы задач.
- Docs/README: долговечные how‑to, референсы, процессы, архитектура.
- Ветки/PR: рабочие изменения. PR ссылается на задачи (ID) и, при наличии, на контент‑пак.

Статусы
- Задачи: `planned | in_progress | blocked | review | done | dropped`
- ADR: `Draft | Accepted | Rejected | Deprecated`
- Контент‑пак: `draft | ready | archived`
- Docs: изменяются через PR (без шкалы статусов)

Связи
- Milestone агрегирует Epics; Epic агрегирует Features; обратные ссылки в фронтматтере (`milestone`, `parent`).
- Контент‑пак содержит `tasks: [M/E/F...]` и ссылки на соответствующие файлы задач.
- PR указывает связанные ID задач и ссылку на файл(ы) пака; задачи содержат ссылки на PR/ADR в `links:` и/или в DoD.

Контрольный список синхронизации
- Задачи обновлены: статус, чек‑листы, ссылки на PR/ADR — актуальны.
- Acceptance Criteria задач выполнены и отмечены.
- ADR создан/обновлён, если были архитектурные/кросс‑сервисные изменения.
- Контент‑пак переведён в `archived` после слияния, добавлены summary и ссылки.
- Документация (reference/how‑to/architecture) обновлена по итогам.

---

## 9) Мини‑ритуал для старта новой задачи

0) Идентификаторы и ветка

- ID задачи (M/E/F): `M-25-01` | `E-25-0001` | `F-25-0101`
- Файл задачи: `docs/tasks/milestones/M-25-01-*.md` | `docs/tasks/epics/E-25-0001-*.md` | `docs/tasks/features/F-25-0101-*.md`
- Ветка: `<type>/<ID>-<slug>` (тип: `feat|fix|docs|chore|refactor|spike`); примеры: `feat/F-25-0101-router-auth`, `feat/E-25-0001-editor-mvp`. Если задач несколько — ID в имя ветки не добавляем; перечисляем их в описании PR и в `tasks: [...]` пакета.

1) Подготовить ADR (если требуется)

- Нужен, если есть архитектурные, межсервисные или несовместимые изменения.
- Скопируйте `docs/architecture/adrs/000-template.md` в новый файл `docs/architecture/adrs/NNN-your-title.md` и заполните.

2) Обновить задачи (docs/tasks)

- Найдите/создайте файлы задач: `milestones/`, `epics/`, `features/` (см. `docs/tasks/README.md`).
- Поставьте актуальный статус (`planned|in_progress|review|done|dropped`), добавьте ссылки на PR/ADR и на контент‑пак (если есть).
- Отметьте чек‑листы и DoD в задачах.
- Если задач несколько — обновите каждую задачу из `tasks: [...]`.

3) Обновить/создать страницы документации

```
docs/architecture/<svc>.md
docs/architecture/<topic>.md
docs/processes/<recipe>.md
```

4) Создать контент‑пакет (минимум)

Файл: `docs/context-packs/CP-25-001-<kebab>-(<TASK_ID>).yaml` (если одна задача) / `docs/context-packs/CP-25-002-<kebab>.yaml` (если задач несколько)

Шаблон:

```yaml
id: CP-25-1234
title: "<кратко о задаче>"
status: draft
role: implementer
owner: "<ник/команда>"
scope:
  code:
    - "services/<svc>/src/**"
    - "services/<svc>/tests/**"
  docs:
    - "docs/architecture/<svc>.md#<section>"
    - "docs/architecture/<topic>.md"
  adr:
    - "docs/architecture/adrs/NNN-<title>.md"  # при необходимости
objectives:
  - "<цель 1>"
  - "<цель 2>"
constraints:
  - "важные ограничения/вводные"
artifacts_expected:
  - "код: services/<svc>/src/**/*"
  - "тесты: services/<svc>/tests/**/*"
  - "итоги: ссылки и краткое summary"
steps_outline:
  - "проверить связанные разделы docs (architecture/reference)"
  - "выполнить работу и тесты"
  - "обновить ADR (при необходимости) и прогнать CI"
links:
  quick_start: "README.md#quick-start"
  testing: "README.md#testing"
  style: "services/<svc>/DEV_GUIDE.md"
  architecture: "docs/architecture/README.md"
post_completion:
  summary: ""
  prs: []
  adr_updates: []
  notes: []
```

5) Актуализировать AGENTS.md (корневой и/или локальный)

- Добавьте ссылки на новые и обновлённые разделы документации и краткие инструкции.

6) Реализация (код и тесты)

7) Завершение задачи и синхронизация

- Обновить документацию (reference/how‑to/architecture)
- ADR: установить финальный статус (Draft → Accepted/Rejected/Deprecated)
- Контент‑пак: перевести в `archived`, добавить краткое описание и ссылки на PR/ADR

8) Чек‑листы

- Выполнить локальный чек‑лист из контент‑пака (steps_outline)
- Пройти общий чек‑лист (раздел про pre‑commit ниже)

---

С таким набором у тебя: есть бриф (context‑pack), есть «почему» (ADR, когда нужно), есть где зафиксировать результат (docs) и есть явные чек‑листы — локальный в контекст‑паке и глобальный.




---

## Контент‑пакеты и задачи
Этот раздел объединён с разделом «3) Лёгкий формат «Context-pack» (бриф исполнителю)». См. актуальные правила там.
