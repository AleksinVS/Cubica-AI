# План исправления `runtime-api` после миграции манифеста Antarctica

## 1. Причина возникновения ошибок (Root Cause)
После миграции манифеста на механизм шаблонов действий (Macros) были обновлены интерфейсы в пакете `@cubica/contracts-manifest` (в частности `GameManifestDeterministicGuard` и `GameManifestDeterministicStateUpdate`). 

В рамках этой миграции были **удалены** жестко закодированные специфичные для игры свойства:
*   В `guard`: удалены `opening`, `card`, `teamSelection`, `team`, `board`. Оставлены только базовые проверки `timeline` и новый обобщенный массив `stateConditions`.
*   В `stateUpdate`: удалены `cardFlags`, `teamFlags`, `boardCardUnlock`, `boardEntryAltCardSwap`, `boardThreshold`, `teamSelection`. Оставлены только базовые обновления `timeline` и новый обобщенный массив `statePatches`.

**Проблема:** Файл движка `services/runtime-api/src/modules/runtime/deterministicHandlers.ts` не был обновлен в соответствии с новыми контрактами. Он всё ещё пытается обращаться к удаленным свойствам, что вызывает **192 ошибки TypeScript** (например, `Property 'cardFlags' does not exist on type 'GameManifestDeterministicStateUpdate'`) и приводит к падению сервиса `runtime-api` при сборке или выполнении. Из-за падения `runtime-api` фронтенд `player-web` не может получить данные игры и выдает ошибку `404/500`.

## 2. План исправления (Action Plan)

Для восстановления работоспособности необходимо отрефакторить файл `services/runtime-api/src/modules/runtime/deterministicHandlers.ts`:

### Шаг 1: Очистка `applyManifestStateUpdate`
*   Удалить всю логику обработки устаревших свойств: `stateUpdate.cardFlags`, `stateUpdate.teamFlags`, `stateUpdate.boardCardUnlock`, `stateUpdate.boardEntryAltCardSwap`, `stateUpdate.boardThreshold`, `stateUpdate.teamSelection`.
*   Убедиться, что применяется только логика обновления `timeline`, `selectedCardId`, `activeInfoId` и перебор массива `statePatches`.

### Шаг 2: Очистка `evaluateManifestGuard`
*   Удалить всю логику валидации для устаревших свойств: `guard.opening`, `guard.card`, `guard.teamSelection`, `guard.team`, `guard.board`.
*   Убедиться, что применяются только проверки `timeline` и перебор массива `guard.stateConditions`.

### Шаг 3: Удаление вспомогательных (dead code) функций
*   Удалить функции, которые больше не используются после шагов 1 и 2, такие как `readTeamSelectionState` и другие специфичные ридеры, если на них больше нет ссылок.

### Шаг 4: Валидация (Typecheck & Tests)
*   Выполнить команду проверки типов:
    ```bash
    npm run typecheck --workspace services/runtime-api
    ```
    Убедиться, что количество ошибок равно 0.
*   Выполнить тесты:
    ```bash
    npm test --workspace services/runtime-api
    npm run smoke --workspace services/runtime-api
    ```

### Шаг 5: Перезапуск сервисов
После успешной компиляции перезапустить сервисы для применения изменений:
```bash
fuser -k 3000/tcp 3001/tcp
npm run dev --workspace services/runtime-api &
npm run dev --workspace @cubica/player-web
```
После этого ошибка 404/500 в `player-web` должна исчезнуть, так как `runtime-api` сможет корректно распарсить обновленный манифест и отдать контент.
