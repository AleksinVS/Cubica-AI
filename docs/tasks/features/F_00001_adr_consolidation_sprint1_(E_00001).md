---
id: F_00001
title: ADR Consolidation & Legacy Cleanup (Sprint 1)
status: done
owner: @claude-code
epic: E_00001
area: architecture
tags: [priority:P0, type:chore]
links:
  - docs/architecture/reviews/2026-01-13-architecture-review-comprehensive.md
  - docs/architecture/PROJECT_ARCHITECTURE.md
---

# FEATURE: ADR Consolidation & Legacy Cleanup (Sprint 1)

## Контекст и цели

По результатам комплексного архитектурного ревью от 2026-01-13 выявлены критические проблемы (P0), требующие немедленного исправления:

- [x] Устранить противоречия между ADR документами
- [x] Синхронизировать PROJECT_ARCHITECTURE.md с актуальными ADR
- [x] Зарегистрировать все известные заглушки в debt-log.csv
- [x] Удалить пустые legacy-файлы

## Объём

**In scope:**
- Удаление пустого дубликата ADR-016
- Обновление статуса ADR-001 (Superseded by ADR-013)
- Добавление раздела "Scope and Exceptions" в ADR-010
- Добавление пропущенных ADR в PROJECT_ARCHITECTURE.md
- Регистрация заглушек LEGACY-0003..0007
- Удаление пустых файлов screen_s1.json, screen_hint.json

**Out of scope:**
- Реализация SDK/viewers/web-base
- Реализация Extension Packs
- Обновление схем манифестов
- Создание референсных примеров

## Задачи

- [x] **Шаг 1: Исправить критические проблемы ADR**
  - [x] Удалить `docs/architecture/adrs/016-viewers-library-architecture.md` (пустой дубликат)
  - [x] Обновить ADR-001: добавить статус "Superseded by ADR-013"
  - [x] Обновить ADR-010: добавить раздел "Scope and Exceptions"
  - [x] Обновить PROJECT_ARCHITECTURE.md: добавить ADR-003, ADR-012, ADR-013, ADR-015

- [x] **Шаг 2: Актуализировать debt-log.csv**
  - [x] LEGACY-0003: Game Engine (отсутствует)
  - [x] LEGACY-0004: Backend services (отсутствуют)
  - [x] LEGACY-0005: SDK/viewers (отсутствует)
  - [x] LEGACY-0006: Extension Packs (отсутствуют)
  - [x] LEGACY-0007: Дублирование манифеста Antarctica

- [x] **Шаг 3: Удалить legacy-файлы**
  - [x] `games/antarctica-nextjs-player/src/app/data/screen_s1.json`
  - [x] `games/antarctica-nextjs-player/src/app/data/screen_hint.json`

## Acceptance Criteria

- [x] Все ADR синхронизированы и не содержат противоречий
- [x] PROJECT_ARCHITECTURE.md упоминает все актуальные ADR (003, 012, 013, 015)
- [x] debt-log.csv содержит записи LEGACY-0003..0007
- [x] Пустые legacy-файлы удалены
- [x] Ревью документ обновлен с отметками о выполненных пунктах

## Definition of Done

- [x] Документация обновлена (ADR-001, ADR-010, PROJECT_ARCHITECTURE.md)
- [x] debt-log.csv актуален (7 записей)
- [x] ROADMAP.md обновлен
- [ ] CI зелёный

## Ссылки

- [Комплексное архитектурное ревью 2026-01-13](../../architecture/reviews/2026-01-13-architecture-review-comprehensive.md)
- [Epic E_00001](../epics/E_00001_architecture_review_consolidation.md)
- ADR-001: `docs/architecture/adrs/001-mvp-and-llm-first-game-manifests.md`
- ADR-010: `docs/architecture/adrs/010-js-sandbox-security.md`

## Выполнено

**Дата:** 2026-01-14

**Изменённые файлы:**
1. `docs/architecture/adrs/016-viewers-library-architecture.md` — удалён
2. `docs/architecture/adrs/001-mvp-and-llm-first-game-manifests.md` — добавлен статус Superseded
3. `docs/architecture/adrs/010-js-sandbox-security.md` — добавлен раздел Scope and Exceptions
4. `docs/architecture/PROJECT_ARCHITECTURE.md` — добавлены ADR-003, 012, 013, 015
5. `docs/legacy/debt-log.csv` — добавлены LEGACY-0003..0007
6. `games/antarctica-nextjs-player/src/app/data/screen_s1.json` — удалён
7. `games/antarctica-nextjs-player/src/app/data/screen_hint.json` — удалён
