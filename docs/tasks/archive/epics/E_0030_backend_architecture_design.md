---
id: E_0030
title: Game Engine & Backend Architecture Design
status: in_progress
owner: @todo
milestone: M_010
area: backend
tags: [priority:P1, type:epic]
links:
  - docs/architecture/PROJECT_ARCHITECTURE.md
---

# EPIC: Game Engine & Backend Architecture Design

## Оглавление
- [Описание](#описание)
- [Результат-для-пользователя](#результат-для-пользователя)
- [Работы-и-зависимости](#работы-и-зависимости)
- [Acceptance-Criteria](#acceptance-criteria)
- [Definition-of-Done](#definition-of-done)

## Описание
Этот эпик посвящен проектированию архитектуры серверной части (Backend) и игрового движка (Game Engine) платформы Cubica. Цель — определить технические решения для критических подсистем, которые обеспечивают работу LLM-first подхода, хранение состояния и многоканальное взаимодействие.

Основные архитектурные вызовы, которые решает этот эпик:
1.  **Управление контекстом LLM:** Как фильтровать и формировать данные для модели, чтобы не превышать лимиты токенов и не "зашумлять" контекст.
2.  **Хранение состояния (State Persistence):** Как хранить активные сессии, обеспечивать атомарность транзакций и обрабатывать конкурентные запросы (Command Pattern).
3.  **Архитектура View-адаптеров:** Как физически организовать работу адаптеров для разных клиентов (Telegram, Web, etc.) — монолит, микросервисы или сайдкары.
4.  **Гибридная модель исполнения (Hybrid Execution):** Как совмещать работу LLM с детерминированным кодом (скриптами/predefined functions) для повышения производительности и надежности.

## Результат-для-пользователя
- **Стабильность:** Игровой процесс не будет ломаться из-за гонок данных или потери состояния.
- **Качество генерации:** LLM будет получать только релевантную информацию, что повысит качество ответов и соблюдение правил игры.
- **Масштабируемость:** Платформа сможет легко подключать новые каналы (клиенты) без переписывания ядра.
- **Отзывчивость:** Простые действия (например, инвентарь) будут работать мгновенно за счет использования скриптового движка.

## Работы-и-зависимости

### Связанные-фичи
- [x] [F_00030: LLM Context Pipeline Architecture](../features/F_00030_llm_context_pipeline.md)
- [x] [F_00031: Session State Persistence Strategy](../features/F_00031_session_state_persistence.md)
- [x] [F_00032: View Adapters Deployment Architecture](../features/F_00032_view_adapters_architecture.md)
- [x] [F_00033: Hybrid Game Engine & Scripting Architecture](../features/F_00033_hybrid_game_engine.md)
- [ ] [F_00041: JS Sandbox Security Specification](../features/F_00041_js_sandbox_security.md)
- [ ] [F_00042: Session Recovery Mechanism](../features/F_00042_session_recovery.md)
- [ ] [F_00060: Multiplayer Architecture](../features/F_00060_multiplayer_architecture.md)
- [ ] [F_00061: Game Editor Intelligence](../features/F_00061_game_editor_intelligence.md)
- [ ] [F_00062: Redis Integration](../features/F_00062_redis_integration.md)

## Acceptance-Criteria
- [x] Создан и утвержден дизайн-документ (или ADR) для пайплайна контекста LLM.
- [x] Выбрана технология и спроектирована схема хранения runtime-состояния сессий.
- [x] Определена архитектура развертывания View-адаптеров и протокол их взаимодействия с Router/Engine.
- [x] Спроектирована гибридная модель исполнения (`llm` vs `script`).
- [x] Обновлен `PROJECT_ARCHITECTURE.md` с учетом принятых решений.
- [ ] Специфицирована безопасность JS-песочницы (ADR или детальный документ).
- [ ] Реализован механизм восстановления сессий после сбоев.
- [ ] Спроектирована архитектура для многопользовательских игр (ADR-011).
- [ ] Определена стратегия интеграции Redis для масштабирования.
- [ ] Улучшены интеллектуальные возможности Game Editor.

## Definition-of-Done
- [ ] Все дочерние фичи завершены.
- [ ] Архитектурная документация в `docs/architecture/` обновлена.
- [ ] Созданы необходимые ADR (ADR-004, ADR-005, ADR-006, ADR-007, ADR-008, ADR-009, ADR-010, ADR-011).

## Связанные документы
- `docs/architecture/PROJECT_ARCHITECTURE.md` — сводное описание архитектуры платформы.
- `docs/architecture/adrs/004-llm-context-pipeline.md` — пайплайн формирования контекста LLM.
- `docs/architecture/adrs/005-session-persistence.md` — стратегия хранения состояния и Session Recovery.
- `docs/architecture/adrs/006-view-adapters-architecture.md` — архитектура развёртывания View Adapters.
- `docs/architecture/adrs/007-hybrid-execution-model.md` — гибридная модель исполнения (LLM + Script).
- `docs/architecture/adrs/010-js-sandbox-security.md` — безопасность JS-песочницы.
- `docs/architecture/adrs/011-multiplayer-architecture.md` — архитектура мультиплеера.
- `docs/architecture/backend/session-persistence.md` — детализация хранения и восстановления сессий.
- `docs/architecture/backend/view-adapters.md` — детализация слоя View Adapters.
