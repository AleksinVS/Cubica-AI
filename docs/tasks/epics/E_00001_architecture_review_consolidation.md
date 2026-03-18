---
id: E_00001
title: Architecture Review & Consolidation
status: in_progress
owner: @claude-code
milestone: M_010
area: architecture
tags: [priority:P0, type:chore, risk:high]
links:
  - docs/architecture/reviews/2026-01-13-architecture-review-comprehensive.md
  - docs/architecture/PROJECT_ARCHITECTURE.md
---

# EPIC: Architecture Review & Consolidation

## Контекст

По результатам комплексного архитектурного ревью от 2026-01-13 выявлено **25 проблем** разного приоритета:
- 5 критических (P0) — противоречия в ADR, незарегистрированные заглушки
- 10 высокого приоритета (P1) — несоответствия схем и примеров
- 5 среднего приоритета (P2) — качество документации
- 5 низкого приоритета (P3) — улучшения

**Текущее соответствие целевой архитектуре: ~30%**

## Цели и метрики

- [ ] Согласованность ADR: 70% → 100%
- [ ] Покрытие debt-log.csv: 20% → 100%
- [ ] Соответствие схем документации: 60% → 95%

## Объём

**In scope:**
- Устранение противоречий в ADR документах
- Регистрация технического долга
- Удаление legacy-файлов
- Обновление схем манифестов
- Создание референсных примеров
- Автоматизация синхронизации манифестов
- Создание базовой структуры SDK/viewers
- Документация безопасности
- Заполнение пропущенных разделов ADR

**Out of scope (Phase 2+):**
- Полная реализация Extension Packs
- Реализация backend-сервисов
- CI/CD интеграция валидации

## Разбиение работ

### Фичи

#### Sprint 1 (Критические проблемы P0) — DONE
- [x] [F_00001: ADR Consolidation & Legacy Cleanup](../features/F_00001_adr_consolidation_sprint1_(E_00001).md)

#### Sprint 2-3 (Краткосрочные задачи P1)
- [x] [F_00002: Manifest Schemas Enhancement](../features/F_00002_manifest_schemas_enhancement_(E_00001).md)
      [CP_00002](../content-packs/CP_00002_manifest_schemas_enhancement.yaml)
- [x] [F_00003: Reference Examples for Manifests](../features/F_00003_reference_examples_for_manifests_(E_00001).md)
      [CP_00003](../content-packs/CP_00003_reference_examples_for_manifests.yaml)
- [x] [F_00004: Manifest Sync Automation](../features/F_00004_manifest_sync_automation_(E_00001).md)
      [CP_00004](../content-packs/CP_00004_manifest_sync_automation.yaml)

#### Phase 1 (Среднесрочные задачи P1-P2)
- [ ] **[F_00005: SDK Viewers Web Base](../features/F_00005_sdk_viewers_web_base_(E_00001).md)**
      [CP_00005](../content-packs/CP_00005_sdk_viewers_web_base.yaml)
- [ ] **[F_00006: Security Documentation](../features/F_00006_security_documentation_(E_00001).md)**
      [CP_00006](../content-packs/CP_00006_security_documentation.yaml)
- [ ] **[F_00007: Training Metadata Guide](../features/F_00007_training_metadata_guide_(E_00001).md)**
      [CP_00007](../content-packs/CP_00007_training_metadata_guide.yaml)
- [ ] **[F_00008: ADR Documentation Completion](../features/F_00008_adr_documentation_completion_(E_00001).md)**
      [CP_00008](../content-packs/CP_00008_adr_documentation_completion.yaml)

## Acceptance Criteria

### Sprint 1 (DONE)
- [x] Все ADR синхронизированы и не содержат противоречий
- [x] debt-log.csv содержит записи для всех известных заглушек
- [x] Пустые legacy-файлы удалены

### Sprint 2-3
- [x] Схемы манифестов обновлены с обязательными полями (F_00002)
- [x] 4 референсных примера созданы (F_00003)
- [x] Синхронизация манифестов автоматизирована (F_00004)

### Phase 1
- [ ] SDK/viewers/web-base создан с базовой структурой (F_00005)
- [ ] Документы безопасности созданы (F_00006)
- [ ] Руководство по training metadata создано (F_00007)
- [ ] Все ADR полностью документированы (F_00008)

## Definition of Done

- [x] Документация обновлена (Sprint 1)
- [x] debt-log.csv актуален
- [x] ROADMAP.md обновлен
- [x] Схемы манифестов обновлены (Sprint 2-3)
- [x] Референсные примеры созданы (Sprint 2-3)
- [x] Single Source of Truth восстановлен (Sprint 2-3)
- [ ] SDK/viewers/web-base реализован (Phase 1)
- [ ] Документы безопасности созданы (Phase 1)
- [ ] ADR полностью документированы (Phase 1)
- [ ] CI зелёный

## Зависимости и риски

- **Риск:** Изменения в ADR могут потребовать согласования с командой
  - **Митигация:** Изменения документируются в ревью-документе

## Ссылки

- [Комплексное архитектурное ревью 2026-01-13](../../architecture/reviews/2026-01-13-architecture-review-comprehensive.md)
