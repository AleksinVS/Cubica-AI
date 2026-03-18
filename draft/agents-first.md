# AGENTS.md — подход agents-first и навигация

Этот документ описывает, как мы используем AGENTS.md и сопутствующие артефакты. Всё, что нужно для исполнения, — рядом с кодом и открывается из репозитория. Подробные справочники и объяснения — в `README.md` и `docs/**`. В AGENTS.md оставляем только то, что ускоряет работу и не дублирует доки.
AGENTS.md — «README для агентов»: единое, предсказуемое место с инструкциями для ИИ (как собрать/тестировать, где писать код, какие правила следовать) — без дублирования человеческой документации. Стандарт поддерживают open-source и tooling-экосистема. 
При этом следует держать AGENTS.md минимальным, а «человеческий» README — полным, чтобы не тратить бюджет контекста и не плодить расхождения.
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

Храним рядом, читается за минуту. Ссылки ведут в доки.

- Где хранить: `docs/context-packs/`
- Пример файла: `docs/context-packs/CP-25-1234-add-router-timeouts.yaml`

```yaml
id: CP-25-1234
title: "Router: add per-endpoint timeouts"
role: implementer          # intended consumer role
scope:
  code:
    - "services/router/src/**"
    - "services/router/tests/**"
  docs:
    - "docs/architecture/README.md"
    - "services/router/docs/DEV_NOTES.md"
    - "docs/architecture/adrs/NNN-router-timeouts.md"
objectives:
  - "Покрыть граничные кейсы и поведение в условиях сбоев"
  - "Развести happy-path и timeout-path"
constraints:
  - "Не нарушить существующие публичные API"
  - "Соблюдать текущие договорённости по логированию"
artifacts_expected:
  - "Исходный код: src/**/*"
  - "Тесты: tests/**/*"
  - "Итоги: краткое резюме в ADR"
steps_outline:
  - "Изучить релевантные разделы docs (architecture/reference)"
  - "Прототип, затем доработка и тесты"
  - "Завести/обновить ADR, прогнать CI"
  - "Обновить docs/ADR и закрыть pack (status=Done)"
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

---

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
- [ ] Context-pack закрыт: status=Done, summary, PR/ADR ссылки
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

1) Сначала «смысл», потом «как»: AGENTS.md и контекст‑пак — для скорости; доки и ADR — для долговременной памяти.
2) Single Source of Truth:
   - Решения, компромиссы, риски — в ADR.
   - Гайды, примеры, конфигурация — в docs/README.
   - Перечень файлов, цели задачи, ограничения — в context‑pack.

Статусы:
   - ADR: Draft/Accepted/Rejected/Deprecated
   - context‑pack: Planned/In-Progress/Done/Archived
   - docs: живые документы; изменения через PR

Контрольные вопросы:
   - Нужен ли ADR (есть ли архитектурные/кросс‑сервисные/несовместимые изменения)?
   - Обновлены ли docs (конфигурация/референс/процессы)?
   - Закрыт ли context‑pack ссылками на PR и ADR?

---

## 9) Мини‑ритуал для старта новой задачи

0) Идентификаторы и ветка

- Issue/ID задачи: `T-25-1234` (в `docs/tasks/T-25-1234.md`)
- Ветка: `feat/T-25-1234-<slug>`

1) Создать Context-pack (минимум)

Файл: `docs/context-packs/CP-25-1234-<slug>.yaml`

Шаблон:

```yaml
id: CP-25-1234
title: "<кратко о задаче>"
status: Planned
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

2) Подготовить ADR (если требуется)

Скопируйте `docs/architecture/adrs/000-template.md` в новый файл `docs/architecture/adrs/NNN-your-title.md` и заполните.

3) Обновить/создать док‑страницы

```
docs/architecture/<svc>.md
docs/architecture/<topic>.md
docs/processes/<recipe>.md
```

4) Актуализировать AGENTS.md (корневой и/или локальный)

Добавьте ссылки на новые/обновлённые разделы docs и краткие инструкции.

5) Реализация (код + тесты)

6) Завершение задачи и синхронизация

- Обновить docs (reference/how-to/architecture)
- ADR: установить финальный статус (Draft → Accepted/Rejected/Deprecated)
- Context-pack: `status: Done`, указать summary и ссылки на PR/ADR

7) Чек‑листы

- Выполнить локальный чек‑лист (steps_outline в pack)
- Пройти глобальный чек-лист (раздел про pre-commit ниже)

---

С таким набором у тебя: есть бриф (context‑pack), есть «почему» (ADR, когда нужно), есть где зафиксировать результат (docs) и есть явные чек‑листы — локальный в контекст‑паке и глобальный.



