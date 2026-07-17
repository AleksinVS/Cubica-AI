# Дизайн платформенных возможностей игр-симуляций реального времени («Симулятор потока»)

Детальный проектный документ к ADR-061 (параметры действий) и ADR-062 (класс
«клиентская симуляция реального времени» и Phaser-канал). Описывает, какие общие
возможности добавляет платформа, как они выглядят в схемах и контрактах, и полную
нормативную спецификацию первой фикстурной игры класса — «Мини-конвейер»
(`games/conveyor-mini/`), которую целиком реализует агент.

Статус: частично заменён ADR-084 (параметры действий, Phaser-канал и игровое
поведение сохраняются; runtime effects/guards/JsonLogic executor заменены).
Исполнительные программы:
`docs/tasks/archive/TSK-20260706-flow-simulation-platform-capabilities.md` (исторический план платформы)
и `docs/tasks/active/TSK-20260706-conveyor-mini-game.md` (игра).

> [!IMPORTANT]
> Разделы с `random.seed`, `metric.set`, `when`, runtime guards, JsonLogic-
> контекстом и полными `effects[]` JSON являются исторической исполнительной
> формой и не копируются. Действующий серверный контракт — Game Intent →
> типизированный Mechanics IR по ADR-084. JsonLogic в этой области остаётся
> только ограниченным языком player-facing computed metrics. Контент, баланс,
> Phaser-границы и приёмочные результаты «Мини-конвейера» остаются входом для
> перепривязки.

## Оглавление

- [1. Цели и границы](#1-цели-и-границы)
- [2. Лучшие практики и источники](#2-лучшие-практики-и-источники)
- [3. Инвентаризация механик класса «Симулятор потока»](#3-инвентаризация-механик-класса-симулятор-потока)
- [4. Дизайн возможностей](#4-дизайн-возможностей)
  - [4.0. Нормативный справочник новых конструкций](#40-нормативный-справочник-новых-конструкций)
  - [4.1. Параметры действий (paramsSchema)](#41-параметры-действий-paramsschema)
  - [4.2. Эффект random.seed](#42-эффект-randomseed)
  - [4.3. Phaser-канал: точка вклада и контракт сцены](#43-phaser-канал-точка-вклада-и-контракт-сцены)
  - [4.4. Компонент simulationSurface в UI-манифесте](#44-компонент-simulationsurface-в-ui-манифесте)
  - [4.5. Клиентский seeded PRNG](#45-клиентский-seeded-prng)
  - [4.6. Конвенция раундового протокола](#46-конвенция-раундового-протокола)
- [5. Механики уровня игры (не платформы)](#5-механики-уровня-игры-не-платформы)
- [6. Фикстурная игра «Мини-конвейер» — нормативная спецификация](#6-фикстурная-игра-мини-конвейер--нормативная-спецификация)
  - [6.1. Обзор и обучающая рамка](#61-обзор-и-обучающая-рамка)
  - [6.2. Контент](#62-контент)
  - [6.3. Состояние и метрики](#63-состояние-и-метрики)
  - [6.4. Действия (полные JSON)](#64-действия-полные-json)
  - [6.5. UI-манифест](#65-ui-манифест)
  - [6.6. Плагин и Phaser-сцена](#66-плагин-и-phaser-сцена)
- [7. Тестирование и воспроизводимость](#7-тестирование-и-воспроизводимость)
- [8. Решённые проектные вопросы](#8-решённые-проектные-вопросы)
- [9. Указания агенту-исполнителю](#9-указания-агенту-исполнителю)
- [10. Координация с параллельным треком настольных игр](#10-координация-с-параллельным-треком-настольных-игр)

---

## 1. Цели и границы

**Цель:** дать платформе канал доставки для класса игр «симулятор потока»
(производственные, складские, логистические тренажёры и тайм-менеджмент в
реальном времени) и доказать generic-путь фикстурной игрой «Мини-конвейер»,
добавив только **общие** возможности (правило 10 `CLAUDE.md`).

**Ключевой принцип класса (ADR-062 §2.1):** реальное время живёт в клиенте,
runtime владеет границами раундов. Phaser-сцена — это View; правила подсчёта,
раунды и метрики — манифест; связь — обычные детерминированные действия.

**Границы:**

- Никаких `if (gameId === "conveyor-mini")` в платформенных слоях (ADR-026, ADR-040).
- JSON Schema остаётся SSOT; контракты генерируются (ADR-025, ADR-056).
- Runtime не получает игрового цикла, тиков и стриминга позиций (ADR-017, ADR-040).
- Микросостояние симуляции (позиции спрайтов, таймеры) не попадает в session
  state (ADR-054).
- Однопользовательский режим; соревновательные/сетевые применения класса — вне
  этого дизайна (граница честности, ADR-062 §2.3).
- Phaser — зависимость платформы, не плагина (ADR-037).

## 2. Лучшие практики и источники

| Практика индустрии | Что берём в Cubica |
|---|---|
| Serious games на Phaser: корпоративные тренажёры, симуляции реальной деятельности (itch.io/genre-simulation, phaser.io showcase) | Класс «симулятор потока» как первый Phaser-класс платформы |
| Client-authoritative результат допустим в однопользовательских обучающих играх; server-authoritative обязателен в соревновательных | Граница честности ADR-062 §2.3: схема + guard-инварианты в MVP, ресимуляция — отдельный ADR |
| Детерминированная генерация уровня из зерна (roguelike/replay-паттерн) | Зерно раунда от серверного PRNG (`random.seed`), весь план раунда — чистая функция зерна (§4.5, §6.6) |
| Инъекция движка вместо прямой зависимости (plugin sandboxing) | Плагин получает объект `Phaser` через контекст; `import "phaser"` в плагине запрещён (§4.3) |
| Ленивая загрузка тяжёлых движков (code splitting) | Динамический `import("phaser")` при первом монтировании `simulationSurface` (§4.3) |

Внутренние переиспользуемые решения: PRNG-модуль и `metric.set` из пакета
настольных игр (ADR-058, нормативный §4.1 `board-game-platform-design.md`),
плагинная инфраструктура ADR-037/039 (`antarctica-player` как образец),
декларативная привязка UI (ADR-055), контекст JsonLogic (`board-game-platform-design.md` §4.0).

## 3. Инвентаризация механик класса «Симулятор потока»

| # | Механика класса | Требуемая возможность | Уровень |
|---|---|---|---|
| 1 | Непрерывная 2D-сцена: движущиеся объекты, drag&drop, игровой цикл | Phaser-канал: точка вклада `phaserSceneFactory`, компонент `simulationSurface` | Платформа (§4.3, §4.4) |
| 2 | Итоги раунда, посчитанные клиентом, попадают в состояние | Параметры действий `paramsSchema` + ветка `params` в JsonLogic | Платформа (§4.1, ADR-061) |
| 3 | Воспроизводимый план раунда (что и когда появляется) | Эффект `random.seed` + клиентский seeded PRNG | Платформа (§4.2, §4.5) |
| 4 | Подсчёт очков по формуле от итогов раунда | `metric.set` со значением JsonLogic | Платформа (ADR-058 §2.5, уже спроектировано) |
| 5 | Проверка правдоподобия итогов (инварианты сумм) | guard-форма `jsonLogic` над `params` | Существующая + §4.1 |
| 6 | Последовательность раундов, экраны между раундами | `timeline.set`, `state.patch`, явные действия | Существующие возможности (ADR-024) |
| 7 | Конкретные правила сортировки/потока, скорости, лейауты сцены | Контент манифеста + плагин игры | Игра (§5, §6) |

Вывод: платформенных возможностей нужно четыре (§4.1–§4.4 + утилита §4.5);
`metric.set` переиспользуется из трека настольных игр; всё остальное — контент.

## 4. Дизайн возможностей

### 4.0. Нормативный справочник новых конструкций

Этот раздел остаётся нормативным только для `paramsSchema`, Phaser-канала,
`simulationSurface`, plugin API и клиентской утилиты seeded PRNG. Серверные
`random.seed`, JsonLogic-контекст и effects-примеры заменены ADR-084 и служат
только описанием требуемого поведения. Все относящиеся к ним JSON-примеры
должны быть заново выражены через текущую схему Mechanics IR.

**Историческая раскладка удалённого runtime-контракта (не реализовывать):**

| Артефакт | Место |
|---|---|
| `paramsSchema` остаётся в схеме; `random.seed` в старом effect registry удалён | `paramsSchema` — `docs/architecture/schemas/game-manifest.schema.json`; случайность — текущий Mechanics catalog |
| Компонент `simulationSurface` | `docs/architecture/schemas/ui-manifest.schema.json` |
| Точка вклада `phaserSceneFactory` | `docs/architecture/schemas/plugin.schema.json` |
| Перегенерация TS-контрактов | `npm run generate:contracts`, проверка — `npm run verify:contracts-schema-parity` |
| Валидация `params`; старый обработчик `random.seed` не восстанавливается | input admission runtime; случайность — типизированный модуль Mechanics |
| Расширение `DispatchActionInput` | `packages/contracts/session` + `requestValidation.ts` |
| Phaser-хост, контракт сцены, seeded PRNG | `apps/player-web` (`plugin-api` — публичные типы и утилита) |
| Фикстурная игра | `games/conveyor-mini/` (отдельная программа TSK) |

**Исторический реестр конструкций:**

| Конструкция | Где | Форма |
|---|---|---|
| Параметры действия | `actions.<id>.paramsSchema` | JSON Schema плоского объекта; ограничения в §4.1 |
| Параметры в запросе | `POST /actions` body | необязательное поле `params: object` |
| Ветка параметров | типизированное выражение Mechanics | `params` — провалидированный объект (или `{}`) |
| Зерно раунда | Mechanics algorithm/command | типизированная запись без публичного JSON Pointer |
| Точка вклада сцены | `plugin.json` → `targets["player-web"].contributes` | `"phaserSceneFactory": true` |
| Компонент поверхности | UI-манифест, компоненты экрана | `{"type": "simulationSurface", "sceneId": "...", "designWidth": 960, "designHeight": 540}` |
| Экспорт плагина | entry-модуль плагина | `export const createSimulationScene: PhaserSceneFactory` |

**Нормативные TS-контракты plugin API** (`apps/player-web`, экспортируются из
`@cubica/player-web/plugin-api`; имена и сигнатуры — контракт):

```ts
/** Снимок сессии для сцены — та же player-facing проекция, что у DOM-рендерера. */
export interface SimulationSessionSnapshot {
  state: { public: Record<string, unknown> };
}

/** Детерминированный PRNG. Алгоритм нормативно совпадает с xoshiro128** из
 * board-game-platform-design.md §4.1 (посев из 32 hex-символов, rejection
 * sampling, Фишер–Йетс). Другая реализация запрещена — разойдётся replay. */
export interface SeededRandom {
  /** Очередное значение 0..2^32-1. */
  nextUint32(): number;
  /** Равномерное целое min..max включительно (rejection sampling). */
  nextInt(min: number, max: number): number;
  /** Число в [0, 1): nextUint32() / 2^32. */
  nextFloat(): number;
  /** Перемешивание Фишера–Йетса на месте; возвращает тот же массив. */
  shuffle<T>(items: T[]): T[];
}

/** Доступ к контент-адресуемым изображениям текущей игры по стабильному id. */
export interface GameAssetResolver {
  /** Возвращает URL файла; неизвестный id считается ошибкой игрового контента. */
  url(assetId: string): string;
  /** Возвращает все id реестра, например для предзагрузки сцены. */
  ids(): ReadonlyArray<string>;
}

/** Контекст, который платформа передаёт фабрике сцены плагина. */
export interface PhaserSceneContext {
  /** Модуль Phaser (инъекция; прямой import "phaser" в плагине запрещён). */
  Phaser: typeof import("phaser");
  /** sceneId из компонента simulationSurface UI-манифеста. */
  sceneId: string;
  /** Player-facing content projection (тот же тип, что у gameConfigFactory). */
  content: GamePlayerUiContent;
  /** Снимок сессии на момент монтирования. */
  session: SimulationSessionSnapshot;
  /** Резолвер изображений игры; при отсутствии реестра остаётся пустым. */
  assets: GameAssetResolver;
  /** Фабрика детерминированного PRNG из hex-зерна (32 символа [0-9a-f]). */
  createSeededRandom(seedHex: string): SeededRandom;
  /** Отправка действия манифеста; params — по paramsSchema действия (ADR-061). */
  dispatchAction(actionId: string, params?: Record<string, unknown>): Promise<void>;
}

/** Результат фабрики: сцена и обратные вызовы жизненного цикла. */
export interface SimulationSceneHandle {
  /** Экземпляр context.Phaser.Scene, созданный плагином (ключ сцены = sceneId). */
  scene: unknown;
  /** Платформа вызывает при каждом обновлении проекции сессии. */
  updateSession(session: SimulationSessionSnapshot): void;
  /** Освобождение ресурсов плагина; Phaser.Game уничтожает платформа. */
  destroy(): void;
}

export type PhaserSceneFactory = (context: PhaserSceneContext) => SimulationSceneHandle;
```

**Нормативный жизненный цикл поверхности (исполняет платформа, `player-web`):**

1. Рендерер встречает компонент `simulationSurface` → лениво загружает Phaser
   (`await import("phaser")`, единственная точка загрузки) → создаёт контейнер
   и `Phaser.Game` c `scale: { mode: FIT, autoCenter: CENTER_BOTH, width:
   designWidth, height: designHeight }`.
2. Вызывает `createSimulationScene(context)` плагина; проверяет, что
   `handle.scene instanceof context.Phaser.Scene`; регистрирует сцену под ключом
   `sceneId` и запускает её.
3. При каждом обновлении player-facing проекции вызывает
   `handle.updateSession(snapshot)`.
4. При размонтировании компонента: `handle.destroy()`, затем
   `game.destroy(true)` (в этом порядке).
5. Ошибка фабрики или отсутствие вклада `phaserSceneFactory` у плагина игры →
   диагностический блок вместо canvas (fail closed, по образцу Surface-проекций
   ADR-047); приложение не падает.

### 4.1. Параметры действий (paramsSchema)

Решение — ADR-061. Нормативные ограничения `paramsSchema`:

- корень: `"type": "object"`, явный `"additionalProperties": false`;
- каждое свойство — ровно один из типов: `integer`, `number`, `string`
  (обязателен `maxLength`, максимум 256; допускается `enum`), `boolean`;
- вложенные объекты и массивы запрещены мета-схемой; не более 16 свойств;
- `required` — обычный массив JSON Schema (решает автор игры).

Пример объявления и запроса:

```json
"actions": {
  "round1.commit": {
    "handlerType": "manifest-data",
    "capabilityFamily": "runtime.server",
    "capability": "conveyor-mini.round1.commit",
    "displayName": "Зафиксировать итоги раунда 1",
    "paramsSchema": {
      "type": "object",
      "additionalProperties": false,
      "required": ["processed", "correct", "missed"],
      "properties": {
        "processed": { "type": "integer", "minimum": 0, "maximum": 99 },
        "correct":   { "type": "integer", "minimum": 0, "maximum": 99 },
        "missed":    { "type": "integer", "minimum": 0, "maximum": 99 }
      }
    },
    "deterministic": { "...": "guard и effects — см. §6.4" }
  }
}
```

```json
POST /actions
{ "sessionId": "…", "actionId": "round1.commit",
  "params": { "processed": 6, "correct": 5, "missed": 2 } }
```

Нормативная семантика исполнения (порядок проверок):

1. Запрос парсится; `params` без объявленной `paramsSchema` → HTTP 400.
2. Ajv-валидация `params` по `paramsSchema` (отсутствующее `params` = `{}`).
   Ошибка → действие отклонено, состояние не изменено.
3. Guards действия вычисляются с веткой `params` в контексте JsonLogic.
4. Эффекты применяются; выражения эффектов видят ту же ветку `params`.
5. Параметры не сохраняются нигде, кроме явных эффектов манифеста.

**Безопасность параметров (нормативно; защита от инъекций):**

Параметры — первый канал недоверенных клиентских данных внутри
детерминированного контура. Правила ниже обязательны для реализации и ревью:

1. **Параметры по умолчанию — инертные данные.** Значение параметра никогда не
   интерпретируется как JSON Pointer, идентификатор метрики/действия, ключ
   объекта или JsonLogic-выражение. Все пути (`storePath`, `patches[].path`),
   идентификаторы и выражения берутся только из манифеста; params входят в
   вычисление исключительно как значения-скаляры через ветку `params`
   контекста JsonLogic (`{"var": "params.processed"}` — обращение объявляет
   манифест, а не клиент). Единственное расширение — строка с объявленной в
   JSON Schema аннотацией `x-cubica-ref` по ADR-074: runtime разрешает ее только
   в заданной манифестом коллекции/сети и повторно проверяет ресурс. Даже такая
   ссылка никогда не становится путем, ключом, выражением или кодом.
2. **Защита от prototype pollution** (загрязнение прототипа — атака через
   ключи `__proto__`/`constructor`/`prototype` в JSON): обеспечивается схемой —
   обязательный явный `additionalProperties: false` и плоские скалярные
   свойства отклоняют любые необъявленные ключи. Defense-in-depth: парсер
   запроса (`requestValidation.ts`) дополнительно отклоняет эти три имени
   ключа на верхнем уровне `params` до Ajv, с тестом на каждый.
3. **Никакого merge/spread**: объект `params` не сливается ни в состояние, ни
   в конфигурацию, ни в другие объекты (исключает и pollution, и случайную
   запись лишних полей). Единственное место жизни params — ветка контекста
   JsonLogic на время исполнения одного действия.
4. **Строки — только данные.** Строковый параметр может попасть в состояние
   только явным эффектом; отображение идёт обычными текстовыми узлами
   рендерера (React экранирует HTML). Использование строковых параметров в
   HTML-разметке, URL или селекторах запрещено.
5. **Границы объёма**: лимиты мета-схемы (≤16 свойств, `maxLength` ≤256, без
   вложенности) плюс существующий лимит тела HTTP-запроса ограничивают
   DoS-поверхность; `paramsSchema` компилируется один раз при загрузке
   манифеста, а не на каждый запрос.
6. **Ajv в строгом режиме** (как весь контур LEGACY-0016), без `coerceTypes`
   и без `useDefaults`: типы не приводятся молча, значения по умолчанию не
   дописываются — что прислал клиент, то и валидируется.

### 4.2. Эффект random.seed

```json
{ "op": "random.seed", "storePath": "/public/round/seed" }
```

- Генерирует 128-битное зерно как строку из 32 hex-символов в нижнем регистре и
  записывает её по `storePath` (JSON Pointer, обязан начинаться с `/public/`).
- Источник — PRNG сессии из ADR-058 §2.1 (`state.secret.random`): берутся 4
  очередных uint32 (`counter` увеличивается на 4), каждое форматируется как 8
  hex-символов с ведущими нулями, конкатенация в порядке взятия.
- Replay-гарантия наследуется: тот же seed сессии + та же последовательность
  действий → те же зёрна раундов.
- Запись дублируется платформенной записью журнала (auditable, ADR-024), по
  образцу `random.roll`.
- Эффект поддерживает общее поле `when` (как все эффекты после ADR-058 Phase 4).

### 4.3. Phaser-канал: точка вклада и контракт сцены

`plugin.json` фикстурной игры (нормативный образец; схема
`plugin.schema.json` расширяется полем `phaserSceneFactory`):

```json
{
  "$schema": "../../../../docs/architecture/schemas/plugin.schema.json",
  "id": "conveyor-mini-player",
  "gameId": "conveyor-mini",
  "apiVersion": "2.0",
  "targets": {
    "player-web": {
      "entry": "src/index.ts",
      "contributes": { "phaserSceneFactory": true }
    }
  },
  "validation": { "typecheck": "typecheck" },
  "permissions": { "network": false, "filesystem": "plugin-root-only", "environment": [] },
  "dependenciesPolicy": "platform-only"
}
```

Нормативные правила:

- Entry-модуль плагина обязан экспортировать `createSimulationScene` типа
  `PhaserSceneFactory` (§4.0). Вклады `gameConfigFactory` и `phaserSceneFactory`
  независимы: игра может объявлять любой из них или оба.
- Плагин не импортирует `phaser` ни статически, ни динамически — только объект
  `context.Phaser`. Проверяется в CI grep-инвариантом (§7).
- Пакет `phaser` добавляется в `apps/player-web` (актуальная стабильная линия
  3.x на момент реализации; версия фиксируется в `package.json` и обновляется
  только платформой).
- Сцена может вызывать `dispatchAction` — платформа передаёт вызов тем же
  каналом, что и DOM-кнопки; ошибка (отклонённое действие) отображается
  стандартным механизмом ошибок player-web и пробрасывается в reject промиса.

### 4.4. Компонент simulationSurface в UI-манифесте

```json
{ "type": "simulationSurface", "sceneId": "main", "designWidth": 960, "designHeight": 540 }
```

- `sceneId`: строка, `^[a-z0-9][a-z0-9-]{0,63}$`, обязательное поле; передаётся
  фабрике сцены как `context.sceneId`.
- `designWidth`/`designHeight`: целые 320..1920, необязательные, по умолчанию
  960×540; задают дизайн-разрешение сцены (масштабирование — режим FIT, §4.0).
- Компонент — платформенный (channel web), добавляется в
  `ui-manifest.schema.json` рядом с существующими типами компонентов; рендерер
  не знает, какая игра его использует (ADR-055).
- Если у игры нет плагина с вкладом `phaserSceneFactory`, компонент рендерится
  диагностическим блоком (§4.0 п.5).

### 4.5. Клиентский seeded PRNG

- Утилита `createSeededRandom(seedHex)` экспортируется из
  `@cubica/player-web/plugin-api` и передаётся сцене через контекст.
- Алгоритм **нормативно идентичен** серверному PRNG из
  `board-game-platform-design.md` §4.1: `xoshiro128**`, посев 4×uint32 из 32
  hex-символов (по 8 на слово), при полностью нулевом состоянии — замена на
  `[1, 2, 3, 4]`, `nextInt` — rejection sampling, `shuffle` — Фишер–Йетс.
  Реализации обязаны давать бит-в-бит одинаковые последовательности; это
  проверяется общим эталонным вектором в тестах обеих сторон.
- Вся игровая случайность сцены (план появления, типы объектов) — только из
  этой утилиты, посеянной зерном раунда из публичного состояния. `Math.random`
  допустим исключительно для нейтральных визуальных эффектов, не влияющих на
  подсчёт (частицы, дрожание) — и это единственное разрешённое исключение.

### 4.6. Конвенция раундового протокола

Конвенция уровня игры (не платформенный примитив, схемой не навязывается) —
нормативна для игр класса «симулятор потока»:

- `state.public.round` — объект `{ "index": число (-1 до старта), "status":
  "idle" | "running" | "done" | "finished", "seed": строка }`.
- «Старт раунда» — действие манифеста: guard проверяет `status`, эффекты —
  `random.seed` → `/public/round/seed`, `state.patch` (index, status,
  обнуление раундовых метрик через `metric.set`), `timeline.set` на экран с
  `simulationSurface`.
- Сцена стартует симуляцию, когда в очередном `updateSession` видит
  `status === "running"` и непустое `seed`; конфигурацию раунда берёт из
  `content` по `round.index`.
- «Фиксация итогов» — действие с `paramsSchema`; сцена вызывает его ровно один
  раз за раунд; guards проверяют `status === "running"`, номер раунда и
  инварианты сумм; эффекты пересчитывают метрики и переводят `status` в
  `done`/`finished`.
- Микросостояние симуляции в session state не записывается; повторный вход в
  экран раунда после перезагрузки страницы при `status === "running"`
  перезапускает раунд с тем же зерном (детерминизм плана делает это честным).

## 5. Механики уровня игры (не платформы)

Выражаются контентом манифеста и кодом плагина поверх §4:

- **Правила потока**: какие объекты появляются, куда их сортировать/направлять,
  скорости, интервалы — данные `content` + логика сцены.
- **Формулы очков**: `metric.set` с JsonLogic над `params` и текущими метриками.
- **Прогрессия сложности**: список раундов в `content` с параметрами; переходы —
  явные действия (ADR-024).
- **Штрафы/бонусы за качество**: guard-инварианты + ветвление `branch`/`when`
  (ADR-058 §2.6) при необходимости.
- **Методическая рамка**: `meta.training` + `content.methodology` (ADR-012).

## 6. Фикстурная игра «Мини-конвейер» — нормативная спецификация

Раздел нормативен: числа, идентификаторы и формулы ниже — контракт приёмки.
Исполнитель не выбирает значения сам.

### 6.1. Обзор и обучающая рамка

- `id`: `conveyor-mini`; название: «Мини-конвейер»; формат `single`;
  длительность 3–7 минут.
- Сюжет: игрок — оператор сортировки. По конвейеру едут детали двух цветов;
  их нужно перетащить в лоток своего цвета до конца ленты. Два раунда с
  возрастающим темпом.
- Компетенции (`meta.training.competencies`):
  `attention-under-pace` («Концентрация под темпом») и `sorting-accuracy`
  («Точность сортировки под нагрузкой»).
- Игра — architecture fixture класса (по образцу `simple-choice` /
  `ai-driven-choice` / `dice-track`): она доказывает generic-путь Phaser-канала
  и входит в game-agnostic CI invariant.

### 6.2. Контент

```json
"content": {
  "data": {
    "itemTypes": [
      { "id": "box-red",  "title": "Красная деталь", "binId": "bin-red",  "color": "#c0392b" },
      { "id": "box-blue", "title": "Синяя деталь",  "binId": "bin-blue", "color": "#2980b9" }
    ],
    "bins": [
      { "id": "bin-red",  "title": "Красный лоток", "color": "#c0392b" },
      { "id": "bin-blue", "title": "Синий лоток",  "color": "#2980b9" }
    ],
    "rounds": [
      { "id": "round-1", "index": 0, "durationSeconds": 30, "itemsTotal": 8,
        "spawnIntervalMs": 2500, "beltSpeedPxPerSec": 120 },
      { "id": "round-2", "index": 1, "durationSeconds": 30, "itemsTotal": 10,
        "spawnIntervalMs": 2000, "beltSpeedPxPerSec": 160 }
    ]
  }
}
```

### 6.3. Состояние и метрики

```json
"state": {
  "public": {
    "timeline": { "line": "main", "stepIndex": 0, "step_index": 0,
                  "stageId": "stage_flow", "stage_id": "stage_flow",
                  "screenId": "intro", "screen_id": "intro", "canAdvance": false },
    "metrics": {
      "score": 0,
      "roundProcessed": 0, "roundCorrect": 0, "roundMissed": 0,
      "processedTotal": 0, "correctTotal": 0, "missedTotal": 0
    },
    "round": { "index": -1, "status": "idle", "seed": "" },
    "flags": { "cards": {} },
    "objects": {},
    "ui": {},
    "log": []
  },
  "secret": {}
}
```

Семантика метрик: `round*` — итоги последнего завершённого/текущего раунда
(перезаписываются), `*Total` — накопительные суммы, `score` — очки по формуле
§6.4. Все правила подсчёта живут в манифесте, не в сцене.

### 6.4. Действия (полные JSON)

> [!CAUTION]
> Полные JSON ниже больше не являются исполнимым контрактом. Они фиксируют
> входы, формулы, проверки и результаты действий для миграции в Game Intents и
> Mechanics IR; `effects[]`, `when` и runtime JsonLogic не восстанавливаются.

Формула очков (нормативная): после каждого раунда
`score = max(0, score + correct*10 - missed*5)`.

Инварианты фиксации (нормативные): `processed + missed == itemsTotal` раунда
(8 для раунда 1, 10 для раунда 2) и `correct <= processed`.

```json
"actions": {
  "round1.start": {
    "handlerType": "manifest-data",
    "capabilityFamily": "runtime.server",
    "capability": "conveyor-mini.round1.start",
    "displayName": "Начать раунд 1",
    "deterministic": {
      "guard": { "jsonLogic": { "==": [ { "var": "public.round.status" }, "idle" ] } },
      "effects": [
        { "op": "random.seed", "storePath": "/public/round/seed" },
        { "op": "state.patch", "patches": [
          { "op": "replace", "path": "/public/round/index",  "value": 0 },
          { "op": "replace", "path": "/public/round/status", "value": "running" } ] },
        { "op": "metric.set", "scope": "session", "metricId": "roundProcessed", "value": 0 },
        { "op": "metric.set", "scope": "session", "metricId": "roundCorrect",   "value": 0 },
        { "op": "metric.set", "scope": "session", "metricId": "roundMissed",    "value": 0 },
        { "op": "timeline.set", "canAdvance": false, "stepIndex": 1, "screenId": "round" },
        { "op": "log.append", "kind": "round-start", "entityType": "round",
          "displayMode": "summary", "summary": "Раунд 1 начался.", "auditMetrics": false }
      ]
    }
  },
  "round1.commit": {
    "handlerType": "manifest-data",
    "capabilityFamily": "runtime.server",
    "capability": "conveyor-mini.round1.commit",
    "displayName": "Зафиксировать итоги раунда 1",
    "paramsSchema": {
      "type": "object",
      "additionalProperties": false,
      "required": ["processed", "correct", "missed"],
      "properties": {
        "processed": { "type": "integer", "minimum": 0, "maximum": 99 },
        "correct":   { "type": "integer", "minimum": 0, "maximum": 99 },
        "missed":    { "type": "integer", "minimum": 0, "maximum": 99 }
      }
    },
    "deterministic": {
      "guard": { "jsonLogic": { "and": [
        { "==": [ { "var": "public.round.status" }, "running" ] },
        { "==": [ { "var": "public.round.index" }, 0 ] },
        { "==": [ { "+": [ { "var": "params.processed" }, { "var": "params.missed" } ] }, 8 ] },
        { "<=": [ { "var": "params.correct" }, { "var": "params.processed" } ] }
      ] } },
      "effects": [
        { "op": "metric.set", "scope": "session", "metricId": "roundProcessed",
          "value": { "jsonLogic": { "var": "params.processed" } } },
        { "op": "metric.set", "scope": "session", "metricId": "roundCorrect",
          "value": { "jsonLogic": { "var": "params.correct" } } },
        { "op": "metric.set", "scope": "session", "metricId": "roundMissed",
          "value": { "jsonLogic": { "var": "params.missed" } } },
        { "op": "metric.set", "scope": "session", "metricId": "processedTotal",
          "value": { "jsonLogic": { "+": [ { "var": "public.metrics.processedTotal" },
                                           { "var": "params.processed" } ] } } },
        { "op": "metric.set", "scope": "session", "metricId": "correctTotal",
          "value": { "jsonLogic": { "+": [ { "var": "public.metrics.correctTotal" },
                                           { "var": "params.correct" } ] } } },
        { "op": "metric.set", "scope": "session", "metricId": "missedTotal",
          "value": { "jsonLogic": { "+": [ { "var": "public.metrics.missedTotal" },
                                           { "var": "params.missed" } ] } } },
        { "op": "metric.set", "scope": "session", "metricId": "score",
          "value": { "jsonLogic": { "max": [ 0, { "+": [ { "var": "public.metrics.score" },
            { "-": [ { "*": [ { "var": "params.correct" }, 10 ] },
                     { "*": [ { "var": "params.missed" }, 5 ] } ] } ] } ] } } },
        { "op": "state.patch", "patches": [
          { "op": "replace", "path": "/public/round/status", "value": "done" } ] },
        { "op": "timeline.set", "canAdvance": false, "stepIndex": 2, "screenId": "between" },
        { "op": "log.append", "kind": "round-result", "entityType": "round",
          "displayMode": "summary", "summary": "Раунд 1 завершён.", "auditMetrics": true }
      ]
    }
  },
  "round2.start": {
    "handlerType": "manifest-data",
    "capabilityFamily": "runtime.server",
    "capability": "conveyor-mini.round2.start",
    "displayName": "Начать раунд 2",
    "deterministic": {
      "guard": { "jsonLogic": { "and": [
        { "==": [ { "var": "public.round.status" }, "done" ] },
        { "==": [ { "var": "public.round.index" }, 0 ] } ] } },
      "effects": [
        { "op": "random.seed", "storePath": "/public/round/seed" },
        { "op": "state.patch", "patches": [
          { "op": "replace", "path": "/public/round/index",  "value": 1 },
          { "op": "replace", "path": "/public/round/status", "value": "running" } ] },
        { "op": "metric.set", "scope": "session", "metricId": "roundProcessed", "value": 0 },
        { "op": "metric.set", "scope": "session", "metricId": "roundCorrect",   "value": 0 },
        { "op": "metric.set", "scope": "session", "metricId": "roundMissed",    "value": 0 },
        { "op": "timeline.set", "canAdvance": false, "stepIndex": 3, "screenId": "round" },
        { "op": "log.append", "kind": "round-start", "entityType": "round",
          "displayMode": "summary", "summary": "Раунд 2 начался.", "auditMetrics": false }
      ]
    }
  },
  "round2.commit": {
    "handlerType": "manifest-data",
    "capabilityFamily": "runtime.server",
    "capability": "conveyor-mini.round2.commit",
    "displayName": "Зафиксировать итоги раунда 2",
    "paramsSchema": {
      "type": "object",
      "additionalProperties": false,
      "required": ["processed", "correct", "missed"],
      "properties": {
        "processed": { "type": "integer", "minimum": 0, "maximum": 99 },
        "correct":   { "type": "integer", "minimum": 0, "maximum": 99 },
        "missed":    { "type": "integer", "minimum": 0, "maximum": 99 }
      }
    },
    "deterministic": {
      "guard": { "jsonLogic": { "and": [
        { "==": [ { "var": "public.round.status" }, "running" ] },
        { "==": [ { "var": "public.round.index" }, 1 ] },
        { "==": [ { "+": [ { "var": "params.processed" }, { "var": "params.missed" } ] }, 10 ] },
        { "<=": [ { "var": "params.correct" }, { "var": "params.processed" } ] }
      ] } },
      "effects": [
        { "op": "metric.set", "scope": "session", "metricId": "roundProcessed",
          "value": { "jsonLogic": { "var": "params.processed" } } },
        { "op": "metric.set", "scope": "session", "metricId": "roundCorrect",
          "value": { "jsonLogic": { "var": "params.correct" } } },
        { "op": "metric.set", "scope": "session", "metricId": "roundMissed",
          "value": { "jsonLogic": { "var": "params.missed" } } },
        { "op": "metric.set", "scope": "session", "metricId": "processedTotal",
          "value": { "jsonLogic": { "+": [ { "var": "public.metrics.processedTotal" },
                                           { "var": "params.processed" } ] } } },
        { "op": "metric.set", "scope": "session", "metricId": "correctTotal",
          "value": { "jsonLogic": { "+": [ { "var": "public.metrics.correctTotal" },
                                           { "var": "params.correct" } ] } } },
        { "op": "metric.set", "scope": "session", "metricId": "missedTotal",
          "value": { "jsonLogic": { "+": [ { "var": "public.metrics.missedTotal" },
                                           { "var": "params.missed" } ] } } },
        { "op": "metric.set", "scope": "session", "metricId": "score",
          "value": { "jsonLogic": { "max": [ 0, { "+": [ { "var": "public.metrics.score" },
            { "-": [ { "*": [ { "var": "params.correct" }, 10 ] },
                     { "*": [ { "var": "params.missed" }, 5 ] } ] } ] } ] } } },
        { "op": "state.patch", "patches": [
          { "op": "replace", "path": "/public/round/status", "value": "finished" } ] },
        { "op": "timeline.set", "canAdvance": false, "stepIndex": 4, "screenId": "results" },
        { "op": "log.append", "kind": "round-result", "entityType": "round",
          "displayMode": "summary", "summary": "Раунд 2 завершён. Игра окончена.",
          "auditMetrics": true }
      ]
    }
  }
}
```

Замечания для исполнителя: секции `meta`, `config` (`players: {min:1, max:1}`,
`mode: "singleplayer"`, `locale: "ru-RU"`), `engine.systemPrompt` — по образцу
`games/simple-choice/game.manifest.json`. Точные имена служебных полей действий
(`capabilityFamily` и т.п.) сверяются с актуальной схемой манифеста на момент
реализации — образец тот же.

### 6.5. UI-манифест

`games/conveyor-mini/ui/web/ui.manifest.json`. Структура, формат экранов и
декларативная привязка кнопок к действиям — строго по образцу
`games/simple-choice/ui/web/ui.manifest.json` (прочитать его перед работой).
Нормативный состав экранов:

| screenId | Состав | Привязка действий |
|---|---|---|
| `intro` | Название, правила (2–4 абзаца: перетащи деталь в лоток своего цвета до конца ленты; красное — в красный, синее — в синий; за верную деталь +10, за пропущенную −5), кнопка «Начать раунд 1» | кнопка → `round1.start` |
| `round` | Компонент `{"type": "simulationSurface", "sceneId": "main"}`; отображение метрики `score` | действия отправляет сцена |
| `between` | Заголовок «Раунд 1 завершён», метрики `roundCorrect`, `roundMissed`, `score`, кнопка «Начать раунд 2» | кнопка → `round2.start` |
| `results` | Заголовок «Игра завершена», метрики `score`, `correctTotal`, `missedTotal`, финальный текст | нет |

Тексты кнопок и подписи метрик — в UI-манифесте (ADR-054: канальная
презентация); смысловые названия метрик — в game-манифесте.

### 6.6. Плагин и Phaser-сцена

Раскладка (по образцу `games/antarctica/plugins/antarctica-player/`):

```text
games/conveyor-mini/plugins/conveyor-mini-player/
  .desc.json           — краткое описание каталога
  plugin.json          — нормативный образец в §4.3
  package.json         — name "@cubica-games/conveyor-mini-player", без dependencies
  tsconfig.json        — по образцу antarctica-player
  src/index.ts         — export const createSimulationScene: PhaserSceneFactory
  src/scene.ts         — класс ConveyorScene (extends context.Phaser.Scene)
  src/spawn-plan.ts    — чистая функция buildSpawnPlan (юнит-тестируемая)
  src/contracts.ts     — типы чтения public state и content
  tests/spawn-plan.test.ts — детерминизм и инварианты плана
```

**Чистая функция плана появления (нормативная сигнатура и алгоритм):**

```ts
export interface SpawnPlanEntry {
  index: number;        // 0..itemsTotal-1
  spawnAtMs: number;    // index * spawnIntervalMs (фиксированный интервал)
  itemTypeId: string;   // выбирается PRNG
}

/** ЕДИНСТВЕННЫЙ источник случайности плана — rng, посеянный зерном раунда.
 * Алгоритм нормативен: для i = 0..itemsTotal-1 по порядку:
 *   itemTypeId = itemTypes[rng.nextInt(0, itemTypes.length - 1)].id
 * Один rng на план; вызовы строго в порядке i. */
export function buildSpawnPlan(
  rng: SeededRandom,
  round: { itemsTotal: number; spawnIntervalMs: number },
  itemTypes: ReadonlyArray<{ id: string }>
): SpawnPlanEntry[];
```

**Поведение сцены (нормативное; дизайн-поле 960×540):**

1. **Ожидание**: до появления в `updateSession` состояния
   `round.status === "running"` с непустым `seed` сцена показывает нейтральную
   заставку «Ожидание раунда…». Конфигурация раунда — `content.data.rounds`
   по `round.index`; типы и лотки — `itemTypes`/`bins` из `content`.
2. **Отсчёт**: оверлей «3-2-1» ровно 3 секунды (таймеры сцены — только
   `this.time` Phaser, не `Date.now`); затем старт симуляции. Отсчёт не входит
   в `durationSeconds`.
3. **Лента**: горизонтальная полоса на y=220; деталь появляется в x=−40 и
   движется вправо со скоростью `beltSpeedPxPerSec`; покинула поле (x > 1000) —
   счётчик `missed` +1, объект удаляется.
4. **Лотки**: `bin-red` — прямоугольник (x=140, y=400, ширина 220, высота 110),
   `bin-blue` — (x=600, y=400, 220×110); цвета и подписи — из `content.bins`.
5. **Перетаскивание**: pointer down на детали снимает её с ленты; отпускание
   внутри прямоугольника лотка — `processed` +1, и если `binId` типа детали
   совпал с лотком — `correct` +1; отпускание вне лотков — деталь возвращается
   на y=220 в текущем x и продолжает движение.
6. **HUD**: слева сверху (16, 16) — оставшееся время раунда (сек), справа
   сверху — счётчики «Обработано/Верно/Пропущено». HUD — отображение локальных
   счётчиков сцены; серверные метрики он не читает.
7. **Конец раунда**: наступает при `processed + missed === itemsTotal` ЛИБО по
   истечении `durationSeconds` (все неразрешённые детали — на ленте или в
   перетаскивании — считаются `missed` и удаляются). Инвариант
   `processed + missed === itemsTotal` обязан выполняться всегда — иначе guard
   отклонит фиксацию.
8. **Фиксация**: оверлей «Раунд завершён», затем ровно один вызов
   `dispatchAction(actionId, { processed, correct, missed })`, где `actionId` =
   `"round1.commit"` при `round.index === 0` и `"round2.commit"` при
   `round.index === 1`. Ошибка отправки — видимое сообщение в сцене и
   возможность повторить отправку (кнопка «Повторить» в оверлее); новых раундов
   сцена сама не начинает.
9. **Смена экрана**: после успешной фиксации состояние переключит экран
   (`between`/`results`); платформа размонтирует поверхность и вызовет
   `destroy()` — сцена обязана снять все таймеры и слушатели.
10. **Графика**: только примитивы Phaser (прямоугольники, круги, текст) с
    цветами из `content`; внешние ассеты (картинки, звук) не используются —
    это фикстура, не продукт.

## 7. Тестирование и воспроизводимость

По ADR-038 (policy layer):

- **Contract-тесты**: `paramsSchema`, `random.seed`, `simulationSurface`,
  `phaserSceneFactory` — позитивные и негативные фикстуры схем; перегенерация
  контрактов; `verify:contracts-schema-parity` зелёный.
- **Unit (runtime-api, node:test)**: валидация params (лишние поля, неверные
  типы, отсутствие схемы + наличие params → 400), `random.seed`
  (фиксированный seed сессии → эталонное зерно, counter +4), ветка `params`
  в контексте JsonLogic.
- **Unit (player-web/plugin-api, Vitest)**: `createSeededRandom` — общий
  эталонный вектор с серверным PRNG (тот же вектор, что в тестах ADR-058
  Phase 1); жизненный цикл поверхности (моки Phaser).
- **Unit (плагин игры, Vitest)**: `buildSpawnPlan` — два вызова с одним зерном
  дают идентичный план; длина = `itemsTotal`; `spawnAtMs = index * interval`;
  все `itemTypeId` существуют; golden-фикстура плана для зерна
  `"0123456789abcdef0123456789abcdef"` записывается при первом корректном
  прогоне и коммитится (защита от смены алгоритма).
- **E2E (Playwright)**: полное прохождение «Мини-конвейера» без взаимодействия
  со сценой — детерминированный сценарий: старт раунда 1 → все 8 деталей
  пропущены → экран `between` показывает `roundMissed = 8`, `score = 0` →
  старт раунда 2 → все 10 пропущены → экран `results` показывает
  `missedTotal = 18`, `score = 0`. Бюджет теста ≤ 120 секунд.
- **Grep-инварианты CI**: `conveyor` не встречается в
  `services/runtime-api/src` и `apps/player-web/src`; `from "phaser"` /
  `import("phaser")` не встречаются в `games/*/plugins/*/src`.
- **Replay**: транскрипт сессии (seed + последовательность действий с params)
  воспроизводит идентичное конечное состояние — автотест на манифесте
  `conveyor-mini` (расширяет replay-контур ADR-058 параметрами действий).

## 8. Решённые проектные вопросы

Все технические вопросы закрыты на этапе проектирования — исполнителю ничего
не выбирать:

1. **Где живёт Phaser — решено**: зависимость `apps/player-web`, ленивая
   загрузка, инъекция в плагин (§4.3). Плагину импортировать запрещено.
2. **Как клиент передаёт результаты — решено**: параметры действий по ADR-061,
   плоская схема, guard-инварианты сумм (§4.1, §6.4).
3. **Детерминизм раунда — решено**: `random.seed` + клиентский PRNG, нормативно
   идентичный серверному xoshiro128** (§4.2, §4.5); фиксированный интервал
   появления, PRNG только для выбора типов (§6.6).
4. **Честность — решено (граница MVP)**: схема + инварианты, без ресимуляции;
   соревновательные режимы — только после отдельного ADR (ADR-062 §2.3).
5. **Формула очков и все числа фикстуры — решены**: §6 нормативен.
6. **Превью редактора — решено**: обычный player preview; hit-test адаптер
   ADR-036 отложен и регистрируется как долг при реализации (ADR-062 §2.5).

## 9. Указания агенту-исполнителю

Раздел адресован агентам, реализующим TSK-программы трека. Правила обязательны.

> [!IMPORTANT]
> Указания ниже применяются только к сохраняющимся Phaser/UI/params частям и
> игровому поведению. Любое указание создать handler старого эффекта, общий
> JsonLogic builder или скопировать `effects[]` отменено ADR-084.

**Порядок работы:**

1. Работай строго по фазам своего TSK-файла: одна фаза — один срез со своими
   тестами. Не начинай следующую фазу, пока команды Validation не зелёные.
2. Перед реализацией любой конструкции сверься с §4.0 — он нормативный. Если
   нужно поле, сигнатура или поведение, которых нет в §4.0, §6 и тексте TSK, —
   не придумывай: остановись и зафиксируй вопрос в Handoff Log.
3. Любое изменение схем (`game-manifest`, `ui-manifest`, `plugin`) сопровождай
   в том же срезе: `npm run generate:contracts`, позитивная И негативная
   фикстуры, обработчик, тест обработчика.
4. Документацию внешних библиотек (Phaser, Ajv) получай через Context7 MCP
   (правило 1 `CLAUDE.md`) — не по памяти: API Phaser между версиями меняется.
5. После каждой фазы обновляй Handoff Log своего TSK.

**Запрещено (типовые ловушки):**

- `Math.random` и `Date.now` в игровой логике (план раунда, счётчики, время
  раунда). Время сцены — только `this.time` Phaser; случайность — только
  `createSeededRandom` (единственное исключение — §4.5, нейтральные визуальные
  эффекты).
- `import "phaser"` (статический или динамический) в коде плагина игры —
  только `context.Phaser`.
- Упоминание `conveyor` / `conveyor-mini` в `services/runtime-api/src` и
  `apps/player-web/src` (generic-тесты могут загружать манифест как данные).
- Запись микросостояния симуляции (позиции, таймеры, промежуточные счётчики) в
  session state; дополнительные dispatch-вызовы сверх «старт»/«фиксация».
- Автоматическая запись `params` в состояние в обход эффектов; расширение
  `paramsSchema` вложенными объектами/массивами.
- Собственная реализация или «улучшение» PRNG: алгоритм нормативно зафиксирован
  (§4.5, board-design §4.1); менять — только новым ADR.
- Игровая логика подсчёта в сцене сверх локальных счётчиков (формулы очков —
  только в манифесте).
- Пересмотр чисел §6 (интервалы, скорости, инварианты) «для играбельности» —
  это контракт приёмки; предложения об улучшении — в Handoff Log, не в код.

**Чек-лист завершения среза:**

```text
[ ] Схема + негативные фикстуры + generate:contracts + verify:contracts-schema-parity
[ ] Обработчик/хост + unit-тесты (node:test / Vitest)
[ ] Grep-инварианты (§7) зелёные
[ ] verify:canonical зелёный
[ ] Handoff Log обновлён
```

## 10. Координация с параллельным треком настольных игр

Трек настольных игр (ADR-058/059/060, `TSK-20260705-*`) идёт параллельно и
владеет общими строительными блоками:

| Зависимость | Владелец | Что нужно этому треку |
|---|---|---|
| PRNG-модуль сессии (`state.secret.random`, xoshiro128**) | ADR-058 Phase 1 (`TSK-20260705-board-game-platform-capabilities`) | `random.seed` строится поверх него (§4.2); эталонный вектор переиспользуется клиентской утилитой (§4.5) |
| `metric.set` со значением JsonLogic, поле `when` | ADR-058 Phase 4 | Формулы очков §6.4 |
| Контекст данных JsonLogic (builder) | ADR-058 Phase 2 (первым создаёт builder) | Ветка `params` добавляется в общий builder (§4.1) |

Нормативные правила координации:

- **Не дублировать**: если блок-владелец ещё не реализовал зависимость, фаза
  этого трека блокируется и ждёт (или переносится вперёд по согласованию в
  Handoff Log обеих задач). Собственные реализации PRNG/metric.set в этом треке
  запрещены.
- **Кто первый — тот создаёт**: builder контекста JsonLogic может появиться в
  любом из треков; второй трек расширяет существующий builder, а не создаёт
  параллельный. Факт передачи владения фиксируется в Handoff Log обеих задач.
- Перед началом каждой фазы сверяться с `git log` по
  `services/runtime-api/src/modules/runtime/` и Handoff Log задач `TSK-20260705-*`.
