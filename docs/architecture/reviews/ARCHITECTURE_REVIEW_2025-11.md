# 🔍 Ревью архитектуры платформы Cubica

**Дата:** Ноябрь 2025  
**Версия:** 1.0  
**Автор:** AI Architect Agent  
**Статус:** Completed

---

## Оглавление

- [1. Резюме](#1-резюме)
- [2. Сильные стороны](#2-сильные-стороны)
- [3. Слабые стороны и риски](#3-слабые-стороны-и-риски)
- [4. Рекомендации по улучшению](#4-рекомендации-по-улучшению)
- [5. Оценка по критериям](#5-оценка-по-критериям)
- [6. Приоритетный план действий](#6-приоритетный-план-действий)

---

## 1. Резюме

Архитектура платформы Cubica представляет собой **зрелый, хорошо продуманный дизайн** для LLM-first игровой платформы. Ключевые решения зафиксированы в 7 ADR, что обеспечивает прозрачность и трассируемость архитектурных выборов.

**Общая оценка: 8/10** — Архитектура готова к MVP, но требует внимания к нескольким критическим областям перед масштабированием.

### Ключевые достижения
- ✅ Чёткое разделение ответственности (MVP + LLM-first)
- ✅ Гибридная модель исполнения (LLM + Script)
- ✅ Абстрактный View Protocol для мультиплатформенности
- ✅ Продуманная стратегия контекста LLM

### Критические области для внимания
- ⚠️ Отсутствие стратегии версионирования манифестов
- ⚠️ Нет описания механизма отката/восстановления сессий
- ⚠️ Безопасность JS-песочницы требует детализации

---

## 2. Сильные стороны

### 2.1. LLM-first с прагматичным гибридом ⭐⭐⭐⭐⭐

**ADR-007 (Hybrid Execution Model)** — одно из лучших архитектурных решений проекта.

| Аспект | Оценка | Комментарий |
|--------|--------|-------------|
| Разделение LLM/Script | Отлично | Чёткие критерии: нарратив → LLM, механика → Script |
| Design-time workflow | Отлично | LLM предлагает, человек утверждает |
| Внешние JS-файлы | Отлично | Улучшает DX, поддерживает IDE |

**Почему это хорошо:**
- Снижает латентность для простых действий (мс вместо секунд)
- Экономит токены (до 90% для UI-навигации)
- Сохраняет детерминизм для критичных механик

### 2.2. Abstract View Protocol ⭐⭐⭐⭐⭐

**ADR-002** определяет элегантный Command Pattern с Promises.

```typescript
interface IViewGateway {
  dispatch(command: ViewCommand): Promise<ViewResponse>;
}
```

**Преимущества:**
- Полная независимость Presenter от UI-библиотек
- Простое тестирование (mock gateway)
- Асинхронность "из коробки" (ожидание анимаций)
- Расширяемость (легко добавить RxJS/Observables)

### 2.3. Hybrid SDUI Schema ⭐⭐⭐⭐

**ADR-003** — умный компромисс между гибкостью и контролем.

| Уровень | Назначение | Пример |
|---------|-----------|--------|
| Atomic | Layout, стили | `container`, `v-stack`, `text` |
| Semantic | Сложная логика | `widget:inventory`, `widget:map` |

**Почему это работает:**
- LLM легко генерирует Atomic-уровень
- Semantic-виджеты инкапсулируют сложность
- Telegram-адаптер может игнорировать Atomic и работать только с Semantic

### 2.4. LLM Context Pipeline ⭐⭐⭐⭐

**ADR-004** решает ключевые проблемы работы с LLM:

1. **Public/Secret State** — безопасность без компромиссов
2. **Smart Summarization** — сохранение контекста в длинных сессиях
3. **Reference Resolution** — правила в Markdown, не в JSON
4. **Design-time Analysis** — Editor генерирует инструкции для суммаризации

### 2.5. Microservices для View Adapters ⭐⭐⭐⭐

**ADR-006** обеспечивает изоляцию платформ:

```
Telegram down ≠ System down
```

**Преимущества:**
- Независимое масштабирование
- Независимый деплой
- Изоляция сбоев

### 2.6. Документация и процессы ⭐⭐⭐⭐⭐

- **7 ADR** с чётким статусом и последствиями
- **Структурированные tasks** (Milestone → Epic → Feature)
- **ROADMAP** с трассируемостью до ADR
- **Схемы манифестов** с примерами

---

## 3. Слабые стороны и риски

### 3.1. Версионирование манифестов 🔴 Критично

**Проблема:** Нет описанной стратегии миграции манифестов при изменении схемы.

**Риски:**
- Игры перестанут работать после обновления Engine
- Невозможно поддерживать legacy-игры
- Нет механизма автоматической миграции

**Где проявится:** При первом breaking change в `game-manifest.schema.json`.

### 3.2. Отказоустойчивость сессий 🔴 Критично

**Проблема:** ADR-005 описывает happy path, но не описывает:
- Что происходит при краше Engine во время LLM-вызова?
- Как восстановить сессию после timeout?
- Механизм retry для LLM-запросов

**Риски:**
- Потеря прогресса игрока
- "Зависшие" сессии с блокировкой

### 3.3. Безопасность JS Sandbox 🟠 Высокий

**Проблема:** ADR-007 упоминает sandbox, но не детализирует:
- Какой runtime (V8 Isolate? QuickJS? vm2?)
- Как ограничивается память?
- Как предотвратить CPU-exhaustion (бесконечные циклы)?
- Аудит `std` библиотеки на уязвимости

**Риски:**
- DoS через вредоносные скрипты
- Побег из песочницы
- Утечка секретов через side-channels

### 3.4. Тестирование LLM-логики 🟠 Высокий

**Проблема:** Нет описанной стратегии тестирования игр.

**Вопросы без ответа:**
- Как тестировать LLM-зависимую логику? (Mock LLM? Snapshot tests?)
- Как гарантировать, что изменение промпта не сломает игру?
- Как тестировать суммаризацию на длинных сессиях?

### 3.5. Observability & Debugging 🟠 Средний

**Проблема:** `PROJECT_OVERVIEW.md` упоминает "Observability by design", но нет конкретики:
- Формат логов
- Трассировка запросов (Correlation ID)
- Метрики (какие? где?)
- Как дебажить "плохой" ответ LLM?

### 3.6. Rate Limiting & Cost Control 🟠 Средний

**Проблема:** Нет описания защиты от:
- Злоупотребления LLM-вызовами (DDoS через игру)
- Контроля бюджета токенов на сессию/пользователя
- Graceful degradation при исчерпании лимитов

### 3.7. Многопользовательские сессии 🟡 Низкий (для MVP)

**Проблема:** Архитектура описывает single-player flow. Для multiplayer:
- Нет описания синхронизации состояния между игроками
- Нет описания конфликтов (два игрока ходят одновременно)
- Нет описания broadcast механизма

### 3.8. Холодный старт Game Editor 🟡 Низкий

**Проблема:** Game Editor описан как LLM-first, но:
- Нет описания как LLM "знает" схему манифеста
- Нет описания валидации сгенерированного манифеста в реальном времени
- Нет описания preview-режима

---

## 4. Рекомендации по улучшению

### 4.1. Немедленные действия (до MVP)

#### R-001: Стратегия версионирования манифестов
**Приоритет:** 🔴 Критично  
**Усилия:** Средние (1-2 дня)

**Предложение:**
```json
{
  "meta": {
    "schema_version": "1.0.0",
    "min_engine_version": "0.5.0"
  }
}
```

**Действия:**
1. Добавить `schema_version` в манифест
2. Engine проверяет совместимость при загрузке
3. Создать ADR-008: Manifest Versioning Strategy
4. Описать процесс миграции (ручной vs автоматический)

#### R-002: Детализация JS Sandbox
**Приоритет:** 🔴 Критично  
**Усилия:** Средние (2-3 дня)

**Предложение:**
```yaml
Runtime: QuickJS (или isolated-vm для V8)
Memory Limit: 16 MB per script
CPU Timeout: 100ms (hard kill)
Allowed APIs:
  - state (read/write)
  - std (safe library)
  - args (readonly)
Forbidden:
  - eval, Function constructor
  - Date.now (side-channel)
  - Math.random (use seeded RNG)
```

**Действия:**
1. Выбрать runtime и зафиксировать в ADR-007
2. Описать threat model
3. Добавить fuzzing в CI

#### R-003: Recovery механизм для сессий
**Приоритет:** 🔴 Критично  
**Усилия:** Низкие (0.5 дня)

**Предложение:**
```sql
ALTER TABLE game_sessions ADD COLUMN processing_state JSONB;
-- Сохраняем состояние ДО LLM-вызова
-- При краше: откатываемся к processing_state
```

**Действия:**
1. Обновить ADR-005 с механизмом checkpoint
2. Добавить поле `processing_started_at` для обнаружения зависших сессий
3. Описать cron-job для очистки зависших блокировок

### 4.2. Краткосрочные улучшения (Phase 2)

#### R-004: Стратегия тестирования
**Приоритет:** 🟠 Высокий  
**Усилия:** Средние (2-3 дня)

**Предложение:**
```yaml
Unit Tests:
  - Script handlers (deterministic)
  - Context Pipeline (mock LLM)
  - State patching logic

Integration Tests:
  - Manifest validation
  - Full game flow with recorded LLM responses

E2E Tests:
  - "Golden path" scenarios with real LLM
  - Regression suite with snapshots
```

**Действия:**
1. Создать `docs/architecture/testing-strategy.md`
2. Определить формат "recorded LLM responses" для replay
3. Интегрировать в CI

#### R-005: Observability Framework
**Приоритет:** 🟠 Высокий  
**Усилия:** Средние (1-2 дня)

**Предложение:**
```yaml
Logging:
  Format: JSON (structured)
  Correlation: X-Request-ID header
  Levels: DEBUG, INFO, WARN, ERROR

Metrics:
  - llm_request_duration_seconds (histogram)
  - llm_tokens_used (counter, by game_id)
  - session_actions_total (counter)
  - script_execution_time_ms (histogram)

Tracing:
  - OpenTelemetry spans for full request lifecycle
```

**Действия:**
1. Создать ADR по Observability Standards
2. Добавить примеры в DEV_GUIDE.md каждого сервиса

#### R-006: Rate Limiting & Budget Control
**Приоритет:** 🟠 Средний  
**Усилия:** Низкие (0.5 дня)

**Предложение:**
```yaml
Limits:
  Per Session:
    - max_actions_per_minute: 30
    - max_llm_tokens_per_session: 100_000
  Per User:
    - max_concurrent_sessions: 5
    - max_llm_tokens_per_day: 500_000

Enforcement:
  - Router checks limits before forwarding to Engine
  - Return 429 with Retry-After header
```

**Действия:**
1. Добавить секцию в ADR-005 или создать отдельный ADR
2. Добавить конфигурацию в манифест (`config.limits`)

### 4.3. Долгосрочные улучшения (Phase 3+)

#### R-007: Multiplayer Architecture
**Приоритет:** 🟡 Низкий (для MVP)  
**Усилия:** Высокие (1-2 недели)

**Ключевые решения:**
- Turn-based vs Real-time
- Conflict resolution (last-write-wins vs merge)
- Broadcast mechanism (WebSocket rooms)

#### R-008: Game Editor Intelligence
**Приоритет:** 🟡 Низкий  
**Усилия:** Высокие

**Ключевые решения:**
- Schema-aware LLM prompting
- Real-time validation feedback
- Visual diff for manifest changes

---

## 5. Оценка по критериям

| Критерий | Оценка | Комментарий |
|----------|--------|-------------|
| **Модульность** | 9/10 | Отличное разделение на сервисы и SDK |
| **Масштабируемость** | 7/10 | Хорошая база, но нужны rate limits и Redis path |
| **Безопасность** | 6/10 | Public/Secret хорошо, но sandbox недоописан |
| **Тестируемость** | 5/10 | Abstract View отлично, но нет стратегии для LLM |
| **Документация** | 9/10 | Отличные ADR и структура задач |
| **Расширяемость** | 8/10 | Гибридная модель и SDUI дают гибкость |
| **Операционность** | 5/10 | Нет observability, нет recovery |
| **DX (Developer Experience)** | 8/10 | Внешние JS, Markdown assets — хорошо |

**Итоговая оценка: 7.1/10** (средневзвешенная)

---

## 6. Приоритетный план действий

### Phase 0: Pre-MVP (1 неделя)

| # | Задача | ADR | Приоритет |
|---|--------|-----|-----------|
| 1 | Manifest Versioning Strategy | ADR-008 (new) | 🔴 |
| 2 | JS Sandbox Specification | ADR-007 (update) | 🔴 |
| 3 | Session Recovery Mechanism | ADR-005 (update) | 🔴 |

### Phase 1: Post-MVP (2-3 недели)

| # | Задача | ADR | Приоритет |
|---|--------|-----|-----------|
| 4 | Testing Strategy | New doc | 🟠 |
| 5 | Observability Standards | New ADR | 🟠 |
| 6 | Rate Limiting | ADR-005/new | 🟠 |

### Phase 2: Scale (1-2 месяца)

| # | Задача | ADR | Приоритет |
|---|--------|-----|-----------|
| 7 | Redis Integration | ADR-005 (update) | 🟡 |
| 8 | Multiplayer Architecture | ADR-011 (new) | 🟡 |
| 9 | Editor Intelligence | New doc | 🟡 |

---

## Заключение

Архитектура Cubica демонстрирует **зрелый подход** к проектированию LLM-first платформы. Ключевые решения (Hybrid Execution, Abstract View, SDUI) являются **инновационными и практичными**.

Основные риски связаны не с концептуальными ошибками, а с **недостаточной детализацией** критических подсистем (sandbox, recovery, observability). Эти пробелы можно закрыть за 1-2 недели целенаправленной работы.

**Рекомендация:** Перед запуском MVP обязательно закрыть пункты R-001, R-002, R-003 из раздела "Немедленные действия".

---

*Документ подготовлен на основе анализа:*
- *7 ADR (001-007)*
- *PROJECT_OVERVIEW.md, PROJECT_ARCHITECTURE.md, PROJECT_STRUCTURE.md*
- *Документов в docs/architecture/engine/, docs/architecture/backend/, docs/architecture/schemas/*
- *Протоколов в docs/architecture/protocols/*

