# Reference brief

## Оглавление

- [Назначение](#назначение)
- [Модель уверенности](#модель-уверенности)
- [Масштабы](#масштабы)
- [Неоднозначности](#неоднозначности)
- [Минимальный пример](#минимальный-пример)

## Назначение

Reference brief - временный проверяемый контракт между изображением и
реализацией. Он описывает только текущую задачу и не становится источником
игровых правил. Хранить его в `.tmp/ui-compare/`.

Схема находится в `schemas/reference-brief.schema.json`. Проверка дополнительно
подтверждает существование файлов, SHA-256, уникальность идентификаторов и
правильную границу решений PM.

## Модель уверенности

Каждое состояние, действие и адаптивное правило имеет `source`:

- `observed` - прямо видно на предоставленном образце;
- `inferred` - агент вывел из назначения и существующих правил проекта;
- `approved` - решение явно подтвердил PM.

Не маскировать вывод агента словом `observed`. Это позволяет следующему агенту
понять, что можно пересмотреть без изменения эталона.

## Масштабы

- `patch` требует `reuse` с путями и SHA-256 существующих инвентаря, профиля и
  манифеста обзора.
- `screen` требует одного или нескольких образцов одного экрана и адаптивных
  правил.
- `flow` связывает несколько состояний через `interactions` и может содержать
  отдельный образец для каждого точного состояния.

## Неоднозначности

`impact: implementation` решает агент и записывает решение. `product` и
`architecture` требуют `resolution: pm`. Неразрешённая запись сохраняется для
обсуждения, но валидатор не пропускает её к реализации.

## Минимальный пример

```json
{
  "$schema": "https://cubica.local/schemas/ui-reference-brief.v1.json",
  "schemaVersion": "1.0",
  "scope": "screen",
  "mode": "pixel-parity",
  "target": { "surface": "player-web", "route": "/play/demo" },
  "references": [
    {
      "id": "desktop-default",
      "path": ".tmp/ui-compare/reference.png",
      "sha256": "<64 hex>",
      "state": "default",
      "viewport": { "width": 1920, "height": 1080 }
    }
  ],
  "states": [
    { "id": "default", "source": "observed", "description": "Начальный экран" }
  ],
  "interactions": [],
  "responsiveRules": [
    {
      "regionId": "primary-panel",
      "behavior": "stack",
      "source": "inferred",
      "notes": "На узком экране панель становится вертикальной"
    }
  ],
  "semantics": [
    {
      "regionId": "primary-action",
      "role": "button",
      "accessibleName": "Продолжить",
      "keyboard": ["Enter", "Space"]
    }
  ],
  "uncertainties": [
    {
      "id": "mobile-order",
      "question": "Как упорядочить панели на мобильном экране?",
      "impact": "implementation",
      "resolution": "agent",
      "decision": "Сохранить порядок чтения из desktop-композиции"
    }
  ],
  "acceptance": [
    { "id": "visual-reference", "kind": "visual", "description": "Эталонный размер совпадает" }
  ]
}
```
