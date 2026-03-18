# Architecture Design: Session State Persistence

## 1. Overview

Этот документ описывает стратегию хранения состояния игровых сессий (**Session State Persistence**) в платформе Cubica.
Он реализует требования надежности, атомарности изменений, поддержки LLM-first процессов и базового механизма восстановления сессий (**Session Recovery**) при сбоях.

## 2. Storage Architecture

В качестве основного хранилища используется реляционная база данных **PostgreSQL**.
Выбор обусловлен надежностью (ACID), мощной поддержкой JSON (`JSONB`) и простотой эксплуатации на этапе MVP.

```mermaid
graph TD
    Client[Game Client] -->|Action Request| Router
    
    subgraph "Router Service"
        LockManager[Concurrency Guard]
        Repo[Session Repository]
    end
    
    subgraph "PostgreSQL Database"
        Table[Table: game_sessions]
    end
    
    Router -->|1. Try Lock| LockManager
    LockManager -->|2. Get Session (SELECT FOR UPDATE)| Table
    Table -->|3. Return State JSON| Router
    
    Router -->|4. Process via Engine/LLM| Engine[Game Engine]
    
    Engine -->|5. State Delta| Router
    Router -->|6. Apply Patch & Save| Table
    Router -->|7. Release Lock| LockManager
```

## 3. Database Schema

### Table: `game_sessions`

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary Key. Уникальный идентификатор сессии. |
| `user_id` | UUID | ID пользователя (владельца сессии). Index. |
| `game_id` | String | ID игры (ссылка на манифест, напр. `com.cubica.antarctica`). |
| `status` | Enum | `active`, `completed`, `archived`. |
| `state` | JSONB | Текущее состояние игры (Public + Secret). |
| `history` | JSONB | "Горячая" история (Sliding Window). |
| `state_version` | Integer | Версия состояния сессии; увеличивается при каждом успешном ходе. |
| `last_event_sequence` | Integer | Номер последнего обработанного события (для интеграции с ADR-011). |
| `metadata` | JSONB | Техническая информация (версия манифеста, debug info). |
| `created_at` | Timestamp | Время начала игры. |
| `updated_at` | Timestamp | Время последнего хода. Index. |

### JSON Structure Example

**Column `state`:**
```json
{
  "public": {
    "location": "library",
    "hp": 95
  },
  "secret": {
    "trap_detected": false,
    "story_summary": "Player entered the library looking for clues."
  }
}
```

**Column `history`:**
```json
[
  { "role": "user", "content": "Look around", "ts": 1715000000 },
  { "role": "assistant", "content": "You see books.", "ts": 1715000005 }
]
```

## 4. Concurrency Control (Locking) и Session Recovery

Поскольку обработка хода LLM занимает продолжительное время (1-10 сек), необходимо предотвратить параллельное изменение состояния одной и той же сессии и при этом уметь восстанавливаться после сбоев.

### 4.1. Базовый алгоритм блокировки

**Алгоритм:**
1.  **Pessimistic Locking:** При получении POST-запроса на действие (`/session/{id}/action`), Router открывает транзакцию и делает запрос:
    ```sql
    SELECT * FROM game_sessions WHERE id = $1 FOR UPDATE NOWAIT;
    ```
2.  **Handling Locked:** Если строка заблокирована (ошибка БД `55P03 lock_not_available`), Router немедленно возвращает клиенту HTTP 429 (или 423).
3.  **Processing:** Если блокировка получена, Router держит транзакцию открытой, пока Engine не вернет результат.
4.  **Commit:** После получения ответа от LLM, Router вычисляет новое состояние, выполняет `UPDATE` и `COMMIT`, что снимает блокировку.

### 4.2. Checkpointing и TTL

Дополнительно к базовому алгоритму вводится логика Session Recovery (см. ADR-005, F_00042):

- **Checkpointing:** Состояние сессии в таблице `game_sessions` рассматривается как последняя устойчивая точка. Пока транзакция не зафиксирована, новые изменения не видны другим запросам; при сбое во время хода состояние автоматически откатывается к последнему сохранённому снимку.
- **TTL (time-to-live) для блокировки:** На уровне приложения Router ограничивает максимальное время обработки одного хода. Если от Engine/LLM не поступил ответ в пределах TTL, запрос завершается с ошибкой, транзакция откатывается, а блокировка снимается.
- **Dead lock detection:** При поступлении новых запросов Router может проверять, не "зависла" ли сессия дольше допустимого времени. Если обнаружена просроченная обработка, отдельный компонент Router (Session Recovery Service) снимает логическую блокировку и возвращает клиенту понятное сообщение о том, что предыдущий ход не был завершён.

Реализация TTL и восстановления описана в интерфейсах Router (`services/router/src/sessionRecovery.ts`) и может быть реализована поверх in-memory хранилища, БД или Redis.

## 5. Scalability Path (Future)

Когда нагрузка на БД возрастет (High Load), архитектура позволяет внедрить **Redis** без изменения контрактов:

1.  **Read-Through Cache:** Чтение сессии сначала идет в Redis.
2.  **Distributed Lock:** Вместо `FOR UPDATE` используется Redis Lock (Redlock).
3.  **Write-Behind:** Запись идет в Redis синхронно, а демон сбрасывает состояние в Postgres асинхронно (с риском потери последних секунд прогресса при крахе Redis).

*На этапе MVP реализуется только вариант "Direct PostgreSQL".*

