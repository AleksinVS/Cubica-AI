# ADR-006: View Adapters Deployment Architecture

## Status
Accepted

## Context
Платформа Cubica должна поддерживать игру через различные интерфейсы (View): Web-браузер, Telegram (Bot/MiniApp), Discord и потенциально другие.
Каждая платформа имеет свои особенности:
1.  **Протоколы:** Web использует WebSocket/HTTP, Telegram — Webhooks/Long-polling.
2.  **Форматы:** Web рендерит сложный React UI, Telegram отображает текст/кнопки.
3.  **Надежность:** Сбои в API Telegram не должны влиять на Web-пользователей.
4.  **Масштабирование:** Нагрузка на Web может быть значительно выше, чем на ботов.

## Decision

Мы принимаем архитектурный паттерн **Adapter Microservices**.

### 1. Разделение сервисов
Каждый тип клиента обслуживается отдельным сервисом-адаптером:
*   **Web Gateway:** Обслуживает WebSocket-соединения для React-клиентов.
*   **Telegram Adapter:** Обрабатывает вебхуки от Telegram Bot API.
*   **Discord Adapter:** Поддерживает соединение с Discord Gateway.

### 2. Протокол взаимодействия (Router <-> Adapter)
*   **Inbound (Adapter -> Router):** Внутренний HTTP REST API.
    *   Адаптер преобразует платформо-специфичные события в унифицированный `ClientRequest` (см. MVP Protocol).
    *   Адаптер выполняет аутентификацию пользователя на уровне платформы.
*   **Outbound (Router -> Adapter):**
    *   **Push-модель:** При создании сессии Адаптер регистрирует `callback_url` (или использует фиксированный адрес сервиса).
    *   Router отправляет `ViewCommand` через HTTP POST на адрес адаптера.
    *   Для Web Gateway используется тот же механизм (Router пушит событие в Gateway, Gateway пушит в WebSocket).

### 3. Аутентификация
*   **Adapter Responsibility:** Адаптер проверяет подлинность запроса от платформы (валидация подписи Telegram, Discord interaction signature).
*   **Trust Boundary:** Router доверяет Адаптерам. Взаимодействие защищено Service-to-Service аутентификацией (например, Internal API Key или mTLS).

## Consequences
*   **Positive:** Полная изоляция сбоев (Telegram down != System down). Возможность независимого масштабирования и деплоя.
*   **Negative:** Усложнение инфраструктуры (нужно деплоить и мониторить несколько сервисов вместо одного монолита).
*   **Mitigation:** Использование Docker Compose / K8s для унификации деплоя.

