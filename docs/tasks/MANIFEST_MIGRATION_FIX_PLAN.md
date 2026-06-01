# Manifest Effects Migration Closeout

Этот документ заменяет прежний план аварийного исправления runtime-api после миграции manifest. План больше не является активной задачей: runtime-api, schema, contracts и манифесты `Antarctica`/`simple-choice` переведены на единый `effects[]` путь.

## Статус

Закрыто 2026-05-31.

Текущая форма deterministic-изменений:

- `timeline.set` для переходов сценария;
- `state.patch` для точечных патчей состояния;
- `metric.add` для изменения метрик;
- `flag.set`, `counter.add`, `collection.append` для игровых признаков, счетчиков и списков;
- `log.append` для журнала, включая `auditMetrics` там, где журнал должен сохранить снимки метрик;
- `ui.panel.open`, `ui.screen.open`, `runtime.server.request` для общих UI/runtime команд.

## Проверки

Закрытие считается действительным только при успешных проверках:

```bash
npm run verify:runtime-api
npm run verify:manifest-authoring
npm run verify:game-agnostic
```

Дополнительно выполняется статический scan на отсутствие прежних deterministic-полей в текущих manifest/schema/runtime/contracts/player/editor областях.
