# Реестр архитектурных разрывов контура Antarctica

**Статус: решения PM приняты 2026-07-19 (см. §0); исполнение — дочерняя
задача `docs/tasks/active/TSK-20260719-antarctica-remediation.md`.**

Задача: `docs/tasks/active/TSK-20260719-antarctica-alignment.md`, блок 2.4.
Дата аудита: 2026-07-19. Метод: только чтение; каждая запись имеет
доказательство «файл:строка», ссылку на нарушенное правило или ADR
(Architecture Decision Record — документ архитектурного решения) и
классификацию. Архитектурные решения по находкам принимает основной агент
после согласования с PM (product manager — владелец продукта).

Пояснение терминов (используются во всём реестре):

- **Дрейф** — расхождение фактического кода/структуры с принятой целевой
  архитектурой; незарегистрированный дрейф запрещён правилом 9 `CLAUDE.md`.
- **SSOT** (single source of truth — единственный источник истины) — принцип,
  по которому у каждого факта есть ровно одно каноническое место хранения.
- **Манифест** — декларативное JSON-описание игры (`game.manifest.json`) или
  её интерфейса (`ui.manifest.json`); компилируется из authoring-источников
  (редактируемых исходников в `games/<id>/authoring/`).
- **Плагин игры** — код, принадлежащий пакету игры
  (`games/<id>/plugins/...`); в нём game-specific логика разрешена, в отличие
  от общих платформенных слоёв (`apps/player-web`, `services/runtime-api`).
- **Asset-канал** — платформенный канал игровых изображений по ADR-063:
  реестр `games/<id>/assets/assets.json`, раздача runtime-api по
  контент-адресуемым URL и ссылки вида `asset:<id>` из UI-манифестов.

## Оглавление

- [0. Решения PM от 2026-07-19 и статус исполнения](#0-решения-pm)
- [1. Сводка](#1-сводка)
- [2. Находки класса violation](#2-находки-класса-violation)
  - [ARC-001 — игровое оформление Antarctica в платформенном globals.css](#arc-001)
  - [ARC-002 — каталог ассетов вне канала ADR-063 и несовместимость с его лимитами](#arc-002)
  - [ARC-003 — зашитый идентификатор игры по умолчанию в точке входа плеера](#arc-003)
  - [ARC-004 — устаревшее описание player-web как «scaffold для Antarctica»](#arc-004)
  - [ARC-005 — мёртвый дубликат design-артефактов в games/antarctica/drafts](#arc-005)
  - [ARC-006 — отсутствие .desc.json в значимых каталогах пакета игры](#arc-006)
  - [ARC-007 — неисполняемый engine-блок в игровом манифесте](#arc-007)
  - [ARC-008 — метрики через устаревший plugin-путь вместо metric_specs манифеста](#arc-008)
- [3. Находки класса already-registered](#3-находки-класса-already-registered)
  - [ARC-009 — файлы игры в public-каталоге player-web (LEGACY-0023)](#arc-009)
- [4. Находки класса intended](#4-находки-класса-intended)
  - [ARC-010 — тестовая связка платформы с Antarctica](#arc-010)
  - [ARC-011 — game-specific резолверы и константы внутри плагина игры](#arc-011)
  - [ARC-012 — фон игры как opt-in `themeBackgroundImage` из плагина](#arc-012)
- [5. Проверено — нарушений не найдено](#5-проверено--нарушений-не-найдено)
- [6. Наблюдение вне контура](#6-наблюдение-вне-контура)

---

<a id="0-решения-pm"></a>
## 0. Решения PM от 2026-07-19 и статус исполнения

Блоки исполнения — по плану
`docs/tasks/active/TSK-20260719-antarctica-remediation.md`.

| Запись | Решение PM | Блок | Статус |
| --- | --- | --- | --- |
| ARC-001 | Устранить сейчас; вариант (а): стили игры как ассет канала ADR-063 / слой UI-манифеста, подключаемый рендерером game-agnostic способом. Пингвины `🐧🐧` удаляются полностью (нет ни в одном эталоне). | R2+R3 | **closed** — ADR-091, канал реализован, `globals.css` 3967→2104 строки (чисто платформенный), `antarctica.css` в пакете игры, эмодзи удалены, охранный флаг жёсткий |
| ARC-002 | (а) лимиты ADR-063 значительно увеличить / переформулировать как рекомендации без цифр; (б) разрывы устранить полностью, включая зарегистрированные долги (LEGACY-0023). | R2+R4 | **closed** — поправка ADR-063 (рекомендации вместо лимитов), реестр `assets.json`, все ссылки `asset:<id>`, резолюция обобщена (R4b), `public/images/` удалён, LEGACY-0023 закрыт |
| ARC-003 | Исправить: при входе без `gameId` показывать ошибку, не сломав тестовый контур. | R5 | **closed** — экран ошибки, unit/e2e-тесты, CI-защита от литералов всех `games/*` |
| ARC-004 | Обновить описание на game-agnostic и перегенерировать `PROJECT_STRUCTURE.yaml`. | R6 | **closed** |
| ARC-005 | Удалить `games/antarctica/drafts/`. | R6 | **closed** |
| ARC-006 | Добавить `.desc.json` минимально необходимым составом (файл значимых для разработки каталогов, не всех подряд). | R6 | **closed** (формат нормализован оркестратором на ключ `"."`) |
| ARC-007 | Принято предложение реестра: удалить мёртвый `engine`-блок. | R7 | **closed** |
| ARC-008 | Принято предложение: `metric_specs` в UI-манифест, сократить plugin-словарь. | R7 | **closed** — 8 записей `metric_specs` с `asset:`-изображениями; в плагине остался минимум caption/aliases для SafeModeRenderer с обоснованием |
| ARC-009 | Устраняется в составе ARC-002 (закрытие LEGACY-0023). | R4 | **closed** — вместе с ARC-002 |
| ARC-010 | Малые проверочные игры для ускорения тестов: сейчас не реализуем, зафиксировать как долг. | R6 | **closed** — долг LEGACY-0074 |
| ARC-011 | Пояснение дано PM; класс `intended`, исправление не требуется. | — | closed |
| ARC-012 | Пояснение дано PM; класс `intended`, исправление не требуется. | — | closed |

---

## 1. Сводка

| Класс | Количество | Записи |
| --- | --- | --- |
| `violation` (незарегистрированный дрейф) | 8 | ARC-001 … ARC-008 |
| `already-registered` (уже учтённый долг) | 1 | ARC-009 |
| `intended` (обоснованное решение) | 3 | ARC-010 … ARC-012 |

Требуют решения PM (затрагивают контракты, источники истины или продуктовое
поведение): **ARC-001, ARC-002, ARC-003**.

---

## 2. Находки класса violation

<a id="arc-001"></a>
### ARC-001 — игровое оформление Antarctica в платформенном globals.css

- **Суть.** Общий платформенный файл стилей `apps/player-web/app/globals.css`
  (3964 строки) массово содержит оформление конкретной игры Antarctica:
  - стили по конкретным id кнопок игры:
    `apps/player-web/app/globals.css:1365-1366`
    (`#btn-journal::before { background-image: url("/images/jurnal-hodov.png") }`,
    `#btn-hint::before { background-image: url("/images/podskazka.png") }`),
    `:2152-2164` (размеры `#btn-journal`, `#btn-hint`),
    `:3523-3526` (`#btn-hint` с `!important`); эти id (`btn-hint`,
    `btn-journal`, `nav-left`, `nav-right`) объявлены в
    `games/antarctica/ui/web/ui.manifest.json` (6/6/5/5 употреблений);
  - ссылки на игровые изображения (`/images/podskazka.png`,
    `/images/jurnal-hodov.png`, `/images/arrow-left.png`) прямо из
    платформенного CSS;
  - декоративная айдентика игры: «пингвины» и «айсберги» —
    `apps/player-web/app/globals.css:1337-1362` (`.sidebar-decoration::after`
    с содержимым `"🐧🐧"`, анимация `penguin-float`), `:1402` («whales &
    icebergs style»), `:1423` («Add CSS iceberg»), `:1141` («Ice shard
    style»), `:1167` («top-sidebar ice assets»);
  - раскладки, привязанные к пиксельным макетам Antarctica: `:537-958`
    (комментарии «per mockup S1», «260px wide per mockup», «3x2 grid» и т.д.).
- **Нарушенное правило.** Правило 10 `CLAUDE.md` (game-specific оформление не
  должно жить в общих слоях платформы); определение game-specific signal в
  ADR-055 §3 прямо включает «конкретный `id` кнопки, имя CSS-класса игры»,
  а §4 п.1 запрещает такие сигналы в generic player lib. Действующие защиты
  уже эту границу не покрывают: `scripts/ci/validate-game-agnostic.js:81-113`
  проверяет только `ui-component-node.tsx` и `layout-helpers.ts`, а
  `apps/player-web/src/presentation-boundary.test.ts:22` запрещает в
  `globals.css` лишь буквальные строки `antarctica|arctic-background`.
- **Классификация.** `violation` — в `docs/legacy/debt-log.csv` записи о
  game-specific стилях в `globals.css` нет (LEGACY-0023 покрывает только
  размещение файлов изображений, см. ARC-009). Оговорка: сама задача
  TSK-20260719 планирует правки «в общих стилях player-web», т.е. канал
  фактически используется, но архитектурно нигде не узаконен.
- **Предлагаемое исправление.** Решение PM о канале game-owned стилей:
  например (а) стили игры как ассет канала ADR-063 / отдельный слой
  UI-манифеста, подключаемый рендерером game-agnostic способом, либо
  (б) явное ADR-решение «общий stylesheet содержит классы всех игр» с
  регистрацией долга и правилами именования. После решения — вынос
  антарктических селекторов и ссылок на игровые изображения из
  `globals.css`.
- **Оценка сложности.** L.
- **Решение PM.** Да — определяется новая контрактная граница (канал
  доставки стилей игры).

<a id="arc-002"></a>
### ARC-002 — каталог ассетов вне канала ADR-063 и несовместимость с его лимитами

- **Суть.** В `games/antarctica/assets/images/` лежат 63 PNG (28 МБ,
  отслеживаются git), но игра не подключена к asset-каналу и текущая копия не
  может быть подключена без преобразований:
  - реестр `games/antarctica/assets/assets.json` отсутствует; валидатор
    честно пропускает каталог: `node scripts/ci/validate-game-assets.js` →
    «OK (2 registries, 1 unregistered legacy directories skipped)»
    (логика пропуска — `scripts/ci/validate-game-assets.js:82-84`);
  - имена файлов нарушают паттерн схемы
    `docs/architecture/schemas/game-assets.schema.json:46`
    (`^[a-z0-9][a-z0-9/_.-]{0,127}\.(png|jpg|webp|svg)$`): 7 файлов с
    кириллицей и пробелами, например
    `games/antarctica/assets/images/Фон - Пингвины на айсберге копия.png`;
  - объёмы несовместимы с лимитами ADR-063 (файл ≤ 512 КБ, игра ≤ 4 МБ,
    ≤ 64 ассетов): суммарно 28 МБ, ≥ 15 файлов больше 512 КБ (например,
    `i02.png` 1.49 МБ, `i5.png` 1.48 МБ);
  - при этом плеер ссылается на изображения, которых нет в действующем
    канале раздачи: `games/antarctica/ui/web/ui.manifest.json:610` использует
    `/images/info/{{currentInfo.id}}.png`, а каталога
    `apps/player-web/public/images/info/` не существует — файлы `i*.png`
    есть только в неподключённом `games/antarctica/assets/images/`;
  - в authoring-источнике `games/antarctica/authoring/ui/web.authoring.json`
    19 ссылок `/images/...` и 0 ссылок формы `asset:<id>`.
- **Нарушенное правило.** ADR-063 (решения 1–5: ассеты игры описываются
  реестром, раздаются контент-адресуемо, адресуются только по id) и правило 9
  `CLAUDE.md` (разрыв должен быть строго задокументирован — дублирующая
  копия 28 МБ нигде не учтена).
- **Классификация.** `violation` с частичным перекрытием долга: базовый факт
  «файлы в public + абсолютные /images-URL» зарегистрирован (LEGACY-0023,
  см. ARC-009), но (а) немигрируемая при текущих лимитах копия в
  `games/antarctica/assets/`, (б) битая ссылка `/images/info/...` и
  (в) отсутствие реестра — за пределами текста записи долга.
- **Предлагаемое исправление.** Решение PM: оптимизация изображений до
  лимитов ADR-063 (пережатие/webp, переименование в допустимый паттерн)
  либо пересмотр лимитов канала отдельной поправкой ADR. Затем: завести
  `assets.json`, перевести authoring-ссылки на `asset:<id>`, удалить дубли
  и закрыть LEGACY-0023.
- **Оценка сложности.** M (техника) — но заблокирована решением о лимитах.
- **Решение PM.** Да — лимиты ADR-063 являются платформенным контрактом.

<a id="arc-003"></a>
### ARC-003 — зашитый идентификатор игры по умолчанию в точке входа плеера

- **Суть.** `apps/player-web/app/page.tsx:19`:
  `const gameId = params?.gameId || "antarctica";` — общая точка входа
  платформенного плеера при отсутствии параметра запускает конкретную игру.
- **Нарушенное правило.** Правило 10 `CLAUDE.md`: «NEVER … hardcode game IDs
  (e.g., "antarctica") in the core platform layers». Прецедент: аналогичный
  `DEFAULT_GAME_ID` уже удалялся из runtime-api
  (`docs/tasks/archive/epics/E_0060_architecture_drift_prevention.md:33`).
  Действующая CI-защита это не ловит:
  `scripts/ci/validate-game-agnostic.js:53-57` запрещает только жёсткую
  передачу `ANTARCTICA_GAME_CONFIG_DATA`, но не id по умолчанию.
- **Классификация.** `violation` — записи в `docs/legacy/debt-log.csv` нет.
- **Предлагаемое исправление.** Убрать дефолт: без `gameId` показывать
  выбор игры/понятную ошибку, либо брать значение из конфигурации
  окружения (переменная среды или portal-ссылка запуска). Обновить e2e,
  которые полагаются на «голый» вход (`apps/player-web/e2e/player-web.spec.ts`
  использует явный `?gameId=...`, риск низкий).
- **Оценка сложности.** S.
- **Решение PM.** Да — меняется продуктовое поведение входа без параметров
  (что видит пользователь по «голому» URL).

<a id="arc-004"></a>
### ARC-004 — устаревшее описание player-web как «scaffold для Antarctica»

- **Суть.** `apps/player-web/.desc.json:2` — «Канонический web player
  scaffold для Antarctica»; то же попало в `PROJECT_STRUCTURE.yaml:17`.
  Фактически `apps/player-web` — универсальный game-agnostic плеер
  (`docs/architecture/PROJECT_ARCHITECTURE.md:43`), обслуживающий шесть игр.
- **Нарушенное правило.** Правило 3 `CLAUDE.md` (документация не должна
  противоречить коду) и правило 11 (`.desc.json`/`PROJECT_STRUCTURE.yaml` —
  машиночитаемый источник истины о структуре).
- **Классификация.** `violation` (документационный дрейф).
- **Предлагаемое исправление.** Обновить описание на game-agnostic
  формулировку и перегенерировать `PROJECT_STRUCTURE.yaml`
  (`node scripts/dev/generate-structure.js`).
- **Оценка сложности.** S.
- **Решение PM.** Нет.

<a id="arc-005"></a>
### ARC-005 — мёртвый дубликат design-артефактов в games/antarctica/drafts

- **Суть.** Каталог `games/antarctica/drafts/` содержит 5 файлов
  `*.design.json` и `design-history.json`, побайтно идентичных файлам в
  `games/antarctica/design/` (проверено `cmp`: все 6 пар IDENTICAL).
  Канонический потребитель использует только `design/`: runtime-api читает
  макеты из `games/<id>/design/mockups`
  (`services/runtime-api/src/modules/content/localFileRepository.ts:77`),
  UI-манифест ссылается на `../../design/`
  (`games/antarctica/ui/web/ui.manifest.json`, блок `design_artifacts`),
  игровой манифест — на `games/antarctica/design/mockups/*`
  (`games/antarctica/game.manifest.json`, `content.design.mockups`).
  На `games/antarctica/drafts/` не ссылается ни один файл кода или
  документации (grep по репозиторию — 0 совпадений).
- **Нарушенное правило.** Принцип SSOT (правило 12 по духу, правило 9 —
  незарегистрированное дублирование); родственный долг LEGACY-0073 покрывает
  только мусор в корне `draft/`, а не этот каталог.
- **Классификация.** `violation`.
- **Предлагаемое исправление.** Удалить `games/antarctica/drafts/`
  (история остаётся в git); либо, если каталог нужен, добавить `.desc.json`
  с назначением и правилом синхронизации.
- **Оценка сложности.** S.
- **Решение PM.** Нет.

<a id="arc-006"></a>
### ARC-006 — отсутствие .desc.json в значимых каталогах пакета игры

- **Суть.** В пакете `games/antarctica/` файлы `.desc.json` (короткое
  семантическое описание каталога, правило 11 `CLAUDE.md`) отсутствуют в:
  `assets/`, `design/`, `drafts/`, `ui/`, `ui/web/`, `ui/telegram/`
  (проверено перечислением; есть только в корне пакета, `authoring/*`,
  `plugins/*`, `published/`). Как следствие, в `PROJECT_STRUCTURE.yaml`
  раздел `antarctica:` показывает только `plugins`
  (`PROJECT_STRUCTURE.yaml:119-120`), скрывая реальные значимые каталоги.
  Для сравнения: `games/simple-choice/ui/web/.desc.json` обязателен даже в
  CI (`scripts/ci/validate-game-agnostic.js:51`).
- **Нарушенное правило.** Правило 11 `CLAUDE.md`.
- **Классификация.** `violation`.
- **Предлагаемое исправление.** Добавить `.desc.json` в перечисленные
  каталоги (кроме удаляемого `drafts/`, см. ARC-005) и перегенерировать
  `PROJECT_STRUCTURE.yaml`.
- **Оценка сложности.** S.
- **Решение PM.** Нет.

<a id="arc-007"></a>
### ARC-007 — неисполняемый engine-блок в игровом манифесте

- **Суть.** `games/antarctica/game.manifest.json` содержит блок `engine`
  (`systemPrompt: «Ты - игровой движок сценария Antarctica…»`,
  `modelConfig`), но: (а) runtime-api нигде не читает `manifest.engine`
  (grep по `services/runtime-api/src` — 0 чтений; единственное упоминание
  `systemPrompt` — сгенерированный тип
  `packages/contracts/manifest/src/generated/game-manifest.ts:285`);
  (б) Antarctica не объявляет `executionMode`, т.е. исполняется
  детерминированным путём Mechanics IR (промежуточное представление правил,
  ADR-084); (в) LLM Context Pipeline, для которого блок задумывался,
  объявлен «справочной исторической моделью»
  (`docs/architecture/PROJECT_ARCHITECTURE.md`, §2.4).
- **Нарушенное правило.** Правило 3 (манифест-описание не должно
  противоречить фактическому исполнению) и правило 9 (неучтённое наследие).
  Смежный, но не покрывающий это долг: LEGACY-0001/0003 (game-engine и LLM
  mock) регистрируют отсутствие сервиса, а не мёртвый блок в манифесте
  Antarctica.
- **Классификация.** `violation` (низкая значимость). Сам факт наличия поля
  `engine` в JSON Schema — действующий опциональный контракт (используется
  фикстурой `ai-driven-choice`), схему менять не предлагается.
- **Предлагаемое исправление.** Удалить блок `engine` из
  `games/antarctica/authoring/game.authoring.json` и перекомпилировать,
  либо оставить с явным пояснением назначения в authoring-комментарии.
- **Оценка сложности.** S.
- **Решение PM.** Нет.

<a id="arc-008"></a>
### ARC-008 — метрики через устаревший plugin-путь вместо metric_specs манифеста

- **Суть.** Подписи, псевдонимы и изображения метрик Antarctica зашиты в
  коде плагина
  (`games/antarctica/plugins/antarctica-player/src/config-data.ts:16-46`:
  `fallbackMetrics` и дублирующий словарь `metricBackgroundImages`), тогда
  как платформенный контракт объявляет этот путь устаревшим:
  `apps/player-web/src/presenter/game-config.ts:20-22` — «@deprecated Смысл
  и подписи метрик должны приходить из game manifest metric catalog.
  FallbackMetricSpec остается только для legacy fallback-экранов». UI-манифест
  Antarctica не публикует `metric_specs`
  (`games/antarctica/ui/web/ui.manifest.json` — ключ отсутствует), в отличие
  от `games/simple-choice` и `games/ai-driven-choice` (ключ есть), при том
  что механизм деривации из манифеста готов
  (`apps/player-web/src/presenter/game-config.ts:193-202`,
  `metricSpecsToFallbackMetrics`; нормализация snake/camel —
  `services/runtime-api/src/modules/content/contentService.ts:226`).
- **Нарушенное правило.** Правило 12 по духу (данные должны быть
  декларативными, в манифесте, а не в императивном коде плагина); правило 9
  (хвост «universality»-миграции «metric specs from manifest» не
  зарегистрирован как долг — в `docs/legacy/debt-log.csv` записи нет).
- **Классификация.** `violation` (незарегистрированный хвост миграции).
- **Предлагаемое исправление.** Добавить `metric_specs` в
  `games/antarctica/authoring/ui/web.authoring.json`, перекомпилировать,
  сократить `config-data.ts` до значений, которых нет в манифесте
  (в пределе — до нуля). Формы URL изображений при этом наследуют судьбу
  ARC-002/ARC-009 (`asset:<id>`).
- **Оценка сложности.** M (нужна проверка журнала и topbar/leftsidebar
  экранов после переноса).
- **Решение PM.** Нет (контракт уже существует и объявлен целевым).

---

## 3. Находки класса already-registered

<a id="arc-009"></a>
### ARC-009 — файлы игры в public-каталоге player-web (LEGACY-0023)

- **Суть.** Изображения Antarctica (28 файлов, 588 КБ) лежат в платформенном
  каталоге `apps/player-web/public/images/` (включая `top-sidebar/`,
  `left-sidebar/`, `decoration/`, `mockup-ref.png`,
  `scene_cards_topsidebar.json`) и адресуются абсолютными URL `/images/...`
  из UI-манифестов игры (19 ссылок в
  `games/antarctica/authoring/ui/web.authoring.json`) и из конфигурации
  плагина (`games/antarctica/plugins/antarctica-player/src/config-data.ts`).
- **Нарушенное правило.** Правило 10 `CLAUDE.md`; целевое решение — ADR-063.
- **Классификация.** `already-registered` — долг LEGACY-0023
  (`docs/legacy/debt-log.csv:24`, `docs/legacy/stubs-register.md:44`),
  статус active: «до миграции абсолютные `/images/...` URL остаются
  поддержанными», миграция — отдельной задачей после ADR-063.
- **Примечание.** Незарегистрированные надстройки над этим долгом вынесены
  в ARC-001 (ссылки из платформенного CSS) и ARC-002 (немигрируемая копия
  в `games/antarctica/assets/`, битая ссылка `/images/info/...`).
- **Предлагаемое исправление.** По плану LEGACY-0023, после решения по
  ARC-002. Оценка M. Решение PM — в составе ARC-002.

---

## 4. Находки класса intended

<a id="arc-010"></a>
### ARC-010 — тестовая связка платформы с Antarctica

- **Суть.** Платформенные тесты и типовые проверки явно используют
  Antarctica: `apps/player-web/tsconfig.json:25-29` (алиас
  `@cubica/antarctica-player-plugin`),
  `apps/player-web/src/components/game-player.test.tsx`,
  `game-player-dom.test.tsx`,
  `apps/player-web/src/test/antarctica-opening-tail-fixtures.ts`,
  `packages/contracts/manifest/tests/type-compat.ts:31,57`,
  `packages/contracts/ai/tests/index.test.ts:653-694`.
- **Где принято решение.** `docs/architecture/testing-strategy.md:33`:
  «`games/antarctica` и `games/simple-choice` являются обязательными
  проверочными играми: первая покрывает сложный сценарий, вторая защищает
  game-agnostic path»; для `type-compat.ts` — заголовок файла (строки 1-27,
  ADR-056: структурная проверка контракта по «representative shipped data»).
  Продакшен-код платформы плагин не импортирует (grep: только тесты), а
  граница охраняется `apps/player-web/src/presentation-boundary.test.ts` и
  `scripts/ci/validate-game-agnostic.js`.
- **Классификация.** `intended`. Исправление не требуется. Решение PM — нет.

<a id="arc-011"></a>
### ARC-011 — game-specific резолверы и константы внутри плагина игры

- **Суть.** Жёсткие игровые знания (индексы шагов доски
  `ANTARCTICA_BOARD_STEP_INDEXES`, ключи экранов `S1`/`S2`/`board-topbar`,
  спец-случай `i0`, русские тексты заглушек) находятся в
  `games/antarctica/plugins/antarctica-player/src/register.ts:34-40,60-108`
  и `state-resolvers.ts`, а не в общих слоях.
- **Где принято решение.** ADR-055 §4 п.5 и §5: «game-specific формы
  состояния и резолверы … живут в game plugin»; резолверы объявлены
  опциональными расширениями в
  `apps/player-web/src/presenter/game-config.ts:76-108` (data-driven
  маршрутизация — путь по умолчанию). Правило 10 `CLAUDE.md` прямо относит
  game-specific механики к бандлу/плагину игры.
- **Классификация.** `intended`. Grep общих слоёв
  (`apps/player-web/src` вне тестов, `services/runtime-api/src`,
  `packages/view-protocol`) упоминаний antarctica/спец-ключей не выявил.
  Решение PM — нет.

<a id="arc-012"></a>
### ARC-012 — фон игры как opt-in `themeBackgroundImage` из плагина

- **Суть.** Фон `arctic-background.png` подключается не платформой, а
  объявлением игры:
  `games/antarctica/plugins/antarctica-player/src/config-data.ts:14`
  (`themeBackgroundImage: "/images/arctic-background.png"`), платформа
  использует его только через CSS-переменную
  (`var(--game-background-image, none)`).
- **Где принято решение.** Комментарий контракта
  `apps/player-web/src/presenter/game-config.ts:57-64` («generic player
  deliberately has no product-specific fallback image … game plugin may opt
  in») и охранный тест
  `apps/player-web/src/presentation-boundary.test.ts:35-42` («keeps the
  Antarctica background opt-in inside its game plugin»).
- **Классификация.** `intended` (механизм). Форма URL `/images/...` —
  часть долга LEGACY-0023 (ARC-009). Решение PM — нет.

---

## 5. Проверено — нарушений не найдено

Зафиксировано для полноты аудита (доказательства получены 2026-07-19):

1. **Паритет authoring → manifest.** `node
   scripts/manifest-tools/compile-authoring-manifests.cjs --check` — все три
   манифеста Antarctica (`game`, `ui/web`, `ui/telegram`) «checked», дрейфа
   сгенерированных файлов нет.
2. **Mechanics IR.** `games/antarctica/game.manifest.json` полностью на
   универсальном языке механик: 140 действий ↔ 140 планов
   (`mechanics.plans`), `apiVersion: cubica.dev/mechanics/v1alpha1`,
   `moduleLock` закрепляет `cubica.core@1.2.0` c `artifactHash` — версия
   действующей линии (`scripts/manifest-tools/mechanics-modules.cjs:239`).
   Старых `deterministic.effects[]` нет (соответствие ADR-083/084 и
   `docs/architecture/runtime-mechanics-language.md`).
3. **Чистота runtime-api и контрактов.** Grep `services/runtime-api/src`,
   `packages/view-protocol`, продакшен-кода `packages/contracts` — упоминаний
   antarctica и карточных/метричных спец-кейсов нет; `npm run
   verify:game-agnostic` — OK.
4. **Плагинный канал.** Плагин объявлен по схеме
   (`games/antarctica/plugins/antarctica-player/plugin.json`: apiVersion 2.0,
   `dependenciesPolicy: "platform-only"`, permissions ограничены), published
   бандл — контент-адресуемый
   (`games/antarctica/published/player-web-plugin-bundles.json`, sha256 в
   имени файла), runtime-api плагинов у игры нет (соответствие ADR-037/039/040
   и LEGACY-0014).
5. **Проекция состояния.** Плагин читает состояние только через публичные
   аксессоры snapshot (`readPublicState`/`readCardObjects` и т.п.), сервер
   строит player-facing проекцию по stateModel (закрытый LEGACY-0049);
   BFF-слой `apps/player-web/app/api/runtime/_shared.ts` game-agnostic.
6. **Версия схемы манифеста.** `meta.schemaVersion: "1.1"` допустима: схема
   (`docs/architecture/schemas/game-manifest.schema.json:1144-1146`)
   не ограничивает значение перечислением; «1.3» у новых игр — не
   нормативное требование.

## 6. Наблюдение вне контура

При прогоне `node scripts/ci/validate-manifest-authoring.js` проверка падает
до завершения на посторонней игре: «games/cards-money-trains/published/
player-web-plugin-bundles.json is stale». К контуру Antarctica не относится
(её бандл проверен раньше по алфавиту), но общий verify-контур сейчас красный —
передано оркестратору задачи.
