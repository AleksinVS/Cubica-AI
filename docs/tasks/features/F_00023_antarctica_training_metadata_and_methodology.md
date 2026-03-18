---
id: F_00023
title: Antarctica — обучающие метаданные и методические материалы
status: stop-list
owner: @todo
epic: E_0020
area: game-player
tags: [priority:P1, type:feature]
links:
  - docs/tasks/brief.md
  - docs/architecture/adrs/012-training-metadata-and-methodology-in-manifest.md
---

# FEATURE: Antarctica — обучающие метаданные и методические материалы

## Оглавление
- [Цели](#цели)
- [Scope](#scope)
- [User-Stories--Задачи](#user-stories--задачи)
- [Acceptance-Criteria](#acceptance-criteria)
- [Definition-of-Done](#definition-of-done)
- [Артефакты и зависимости](#артефакты-и-зависимости)

## Цели
- [ ] Заполнить `meta.training` в манифесте «Antarctica» (компетенции, формат, длительность) в соответствии с ADR-012.
- [ ] Добавить `.md` методички для участников и ведущих в `assets.methodology` и связать их с манифестом.
- [ ] Обеспечить трассируемость методических материалов к версиям игры и готовность к использованию в каталоге/редакторе.

## Scope
- In scope:
  - Определение тренируемых компетенций, формата (single/single_team/multi) и длительности (`min_minutes`, `max_minutes`) для сценария «Antarctica».
  - Создание и привязка Markdown-файлов методических материалов: `participants` и `facilitators`.
  - Обновление манифеста `antarctica` с новыми полями и ссылками.
- Out of scope:
  - Автоматическая интеграция методичек в UI плеера (отдельные задачи).
  - Полное UX для каталога по фильтрации компетенций (будущие задачи каталога).

## User-Stories--Задачи
- [ ] Как методист, я вижу в манифесте список компетенций, формат игры и рекомендуемую длительность.
- [ ] Как ведущий, я имею доступ к `.md` с вопросами, подсказками и критериями оценки.
- [ ] Как участник, я вижу `.md` с правилами, описаниями сущностей и чек-листами (если применимо).

## Acceptance-Criteria
- [ ] `meta.training` заполнен (competencies, format, duration) и валиден к `game-manifest.schema.json`.
- [ ] `assets.methodology.participants` и `assets.methodology.facilitators` указывают на существующие `.md` в репозитории, версионируемые вместе с манифестом.
- [ ] Содержимое методичек отражает правила, описания, рекомендации/подсказки и вопросы/критерии, заявленные в задаче.
- [ ] Эпик E_0020 и ROADMAP содержат ссылку на эту фичу и актуальный статус.

## Definition-of-Done
- [ ] Создан ExecPlan (CP_00023-*.yaml) и выполнен.
- [ ] Манифест «Antarctica» обновлён с `meta.training` и `assets.methodology`.
- [ ] Методические `.md` добавлены и согласованы по содержанию.
- [ ] Документация задач (эпик, ROADMAP) обновлена.

## Артефакты и зависимости
- Манифест: `games/antarctica-nextjs-player/src/app/data/antarctica/manifest.json` (из фичи F_00021).
- Методички: `assets/methodology/antarctica-participants.md`, `assets/methodology/antarctica-facilitators.md` (пути примерные, уточнить при реализации).
- ADR-012: `docs/architecture/adrs/012-training-metadata-and-methodology-in-manifest.md`.
