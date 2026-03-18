# Hybrid Execution Example: RPG Inventory System

## Оглавление

- [Обзор](#обзор)
- [Структура файлов](#структура-файлов)
- [Гибридная модель выполнения](#гибридная-модель-выполнения)
- [API скриптов](#api-скриптов)
- [Стандартная библиотека (std)](#стандартная-библиотека-std)
- [Безопасность и изоляция](#безопасность-и-изоляция)
- [Примеры использования](#примеры-использования)
- [Связь с ADR](#связь-с-adr)

---

## Обзор

Этот пример демонстрирует **гибридную модель выполнения (Hybrid Execution Model)** согласно [ADR-007: Hybrid Execution Model (LLM + JS Script)](../../../adrs/007-hybrid-execution-model.md).

**Ключевая идея:** не все игровые действия требуют обработки языковой моделью (LLM). Тривиальные операции (инвентарь, расчеты, торговля) выполняются быстрее и надежнее через JavaScript-скрипты.

### Преимущества гибридной модели

| Критерий | LLM Handler | Script Handler |
|----------|-------------|----------------|
| Скорость | 1-5 сек | < 100 мс |
| Стоимость | Токены API | Бесплатно |
| Детерминизм | Вариативно | 100% |
| Креативность | Высокая | Низкая |
| Использование | Нарратив, диалоги | Механики, расчеты |

---

## Структура файлов

```
hybrid-execution/
  game.manifest.json       # Манифест игры с регистрацией действий
  scripts/
    inventory.js           # Скрипты обработки инвентаря
  README.md                # Этот файл
```

---

## Гибридная модель выполнения

### Типы обработчиков

В секции `actions` манифеста каждое действие указывает свой `handler_type`:

```json
"actions": {
  "talk": {
    "handler_type": "llm",
    "metadata": { "description": "Диалоги обрабатываются LLM" }
  },
  "add_item": {
    "handler_type": "script",
    "function": "addItem",
    "metadata": { "description": "Добавление предмета в инвентарь" }
  }
}
```

### Маршрутизация действий

```
Действие от UI (например, "add_item")
           ↓
     Engine Router
           ↓
   Проверка handler_type
           ↓
    ┌──────┴──────┐
    ↓             ↓
  "llm"       "script"
    ↓             ↓
  LLM API    JS Sandbox
    ↓             ↓
  Нарратив    Детерминированный
  ответ       результат
           ↓
   Обновление state
           ↓
      UI обновляется
```

### Связь скриптов с манифестом

1. **Файл скриптов** указывается в `assets.scripts`:
   ```json
   "assets": {
     "scripts": "scripts/inventory.js"
   }
   ```

2. **Функция** указывается в действии:
   ```json
   "add_item": {
     "handler_type": "script",
     "function": "addItem"
   }
   ```

3. **Движок** загружает файл и вызывает экспортированную функцию.

---

## API скриптов

### Сигнатура функции-обработчика

```javascript
/**
 * @param {Object} state - Текущее состояние игры
 * @param {Object} args - Аргументы действия
 * @param {Object} std - Стандартная библиотека движка
 * @returns {Object} Результат выполнения
 */
export function actionHandler(state, args, std) {
  // Логика обработки
  return { success: true, /* дополнительные данные */ };
}
```

### Параметр `state`

Содержит текущее состояние игры:

```javascript
state = {
  public: {
    player: { name: "Hero", hp: 100, gold: 100 },
    inventory: { slots: [...], max_slots: 20 },
    equipment: { weapon: null, armor: null }
  },
  secret: {
    shop_inventory: [...],
    loot_tables: {...}
  }
}
```

- **`state.public`** — видимая часть состояния (передается в LLM и UI).
- **`state.secret`** — скрытая часть (только для скриптов и движка).

**Важно:** Скрипт может изменять `state` напрямую. Изменения применяются атомарно после успешного завершения.

### Параметр `args`

Содержит аргументы, переданные из UI:

```javascript
// Вызов из UI:
// { "command": "add_item", "payload": { "itemId": "health_potion", "quantity": 3 } }

// В скрипте:
function addItem(state, args, std) {
  const { itemId, quantity = 1 } = args;
  // itemId = "health_potion"
  // quantity = 3
}
```

### Возвращаемое значение

Скрипт должен возвращать объект с результатом:

```javascript
// Успех
return { success: true, added: 3, message: "Items added" };

// Ошибка
return { success: false, error: "INVENTORY_FULL" };
```

---

## Стандартная библиотека (std)

Движок предоставляет скриптам объект `std` с вспомогательными функциями.

### std.ui — Работа с интерфейсом

```javascript
// Показать уведомление (toast)
std.ui.toast("Added 3x Health Potion");

// Показать ошибку
std.ui.error("Inventory is full!");

// Показать диалог подтверждения (если поддерживается)
const confirmed = await std.ui.confirm("Sell all items?");
```

### std.items — Работа с определениями предметов

```javascript
// Получить определение предмета из манифеста
const itemDef = std.items.get("health_potion");
// itemDef = {
//   id: "health_potion",
//   name: "Health Potion",
//   type: "consumable",
//   stackable: true,
//   max_stack: 99,
//   effects: { heal: 30 }
// }

// Проверить существование предмета
if (!std.items.exists("unknown_item")) {
  std.ui.error("Item not found");
}
```

### std.inventory — Вспомогательные функции инвентаря

```javascript
// Проверить наличие предмета
const hasPotion = std.inventory.has(state, "health_potion");

// Получить количество предмета
const potionCount = std.inventory.count(state, "health_potion");

// Добавить предмет (обертка над логикой)
std.inventory.add(state, "health_potion", 1);

// Удалить предмет
std.inventory.remove(state, "health_potion", 1);
```

### std.random — Генерация случайных чисел

```javascript
// Случайное число от 0 до 1
const roll = std.random.float();

// Случайное целое в диапазоне [min, max]
const damage = std.random.int(10, 20);

// Выбор случайного элемента из массива
const loot = std.random.choice(["gold", "potion", "sword"]);
```

---

## Безопасность и изоляция

### Sandbox (песочница)

Скрипты выполняются в изолированной среде:

- **Нет доступа** к файловой системе (`fs`).
- **Нет доступа** к сети (`fetch`, `http`).
- **Нет доступа** к глобальным объектам Node.js (`process`, `require`).
- **Доступ только** к `state`, `args`, `std`.

### Тайм-аут выполнения

Скрипт имеет ограниченное время выполнения (по умолчанию 100 мс):

```javascript
// Этот код вызовет тайм-аут и прерывание
while (true) {
  // Бесконечный цикл
}
// Результат: { success: false, error: "SCRIPT_TIMEOUT" }
```

### Атомарность изменений

Изменения состояния применяются только при успешном завершении скрипта:

1. Движок создает копию `state`.
2. Скрипт изменяет копию.
3. При `success: true` — копия становится новым состоянием.
4. При ошибке или тайм-ауте — изменения откатываются.

---

## Примеры использования

### Добавление предмета в инвентарь

**UI отправляет:**
```json
{
  "command": "add_item",
  "payload": { "itemId": "health_potion", "quantity": 3 }
}
```

**Скрипт выполняет:**
```javascript
export function addItem(state, args, std) {
  const { itemId, quantity = 1 } = args;

  // Получаем определение предмета
  const itemDef = std.items.get(itemId);
  if (!itemDef) {
    std.ui.error(`Unknown item: ${itemId}`);
    return { success: false, error: 'ITEM_NOT_FOUND' };
  }

  // Добавляем в инвентарь
  state.public.inventory.slots.push({
    itemId: itemId,
    quantity: quantity
  });

  std.ui.toast(`Added ${quantity}x ${itemDef.name}`);
  return { success: true, added: quantity };
}
```

### Использование зелья

**UI отправляет:**
```json
{
  "command": "use_item",
  "payload": { "itemId": "health_potion" }
}
```

**Скрипт выполняет:**
```javascript
export function useItem(state, args, std) {
  const { itemId } = args;
  const player = state.public.player;
  const itemDef = std.items.get(itemId);

  // Применяем эффект лечения
  if (itemDef.effects.heal) {
    const actualHeal = Math.min(
      itemDef.effects.heal,
      player.max_hp - player.hp
    );
    player.hp += actualHeal;

    // Удаляем использованный предмет
    removeItem(state, { itemId, quantity: 1 }, std);

    std.ui.toast(`Healed ${actualHeal} HP`);
    return { success: true, healed: actualHeal };
  }
}
```

### Покупка в магазине

**UI отправляет:**
```json
{
  "command": "buy_item",
  "payload": { "itemId": "iron_sword", "quantity": 1 }
}
```

**Скрипт выполняет:**
```javascript
export function buyItem(state, args, std) {
  const { itemId, quantity = 1 } = args;
  const player = state.public.player;
  const shopItem = state.secret.shop_inventory.find(i => i.id === itemId);

  // Проверки
  if (!shopItem) return { success: false, error: 'ITEM_NOT_IN_SHOP' };
  if (shopItem.stock < quantity) return { success: false, error: 'OUT_OF_STOCK' };

  const totalCost = shopItem.price * quantity;
  if (player.gold < totalCost) return { success: false, error: 'NOT_ENOUGH_GOLD' };

  // Транзакция
  player.gold -= totalCost;
  shopItem.stock -= quantity;
  addItem(state, { itemId, quantity }, std);

  return { success: true, cost: totalCost };
}
```

---

## Связь с ADR

Этот пример реализует следующие решения из [ADR-007](../../../adrs/007-hybrid-execution-model.md):

| Решение ADR | Реализация в примере |
|-------------|---------------------|
| handler_type: "script" | Действия `add_item`, `use_item`, `buy_item` и др. |
| Внешние JS-файлы | `scripts/inventory.js` |
| Ссылка через assets.scripts | `"scripts": "scripts/inventory.js"` |
| Стандартная библиотека (std) | `std.ui`, `std.items` в скриптах |
| Sandbox-изоляция | Скрипты не имеют доступа к fs/network |
| Тайм-аут выполнения | Движок прерывает скрипты > 100мс |

---

## Полезные ссылки

- [ADR-007: Hybrid Execution Model](../../../adrs/007-hybrid-execution-model.md)
- [ADR-010: JS Sandbox Security](../../../adrs/010-js-sandbox-security.md)
- [JSON Schema: game-manifest](../../game-manifest.schema.json)
- [Split Manifest Example](../split-manifest/) — разделение манифестов
