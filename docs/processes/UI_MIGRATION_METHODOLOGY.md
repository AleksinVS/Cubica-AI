# Методика миграции UI визуальной парадигмы из Draft в Target

## Обзор

Методика описывает пошаговый подход к копированию точного внешнего вида UI из одного Next.js-приложения (draft) в другое (target), без изменения архитектуры target-приложения.

---

## 0. Подготовка мок-данных и фикстур

**Принцип:** сравнение draft ↔ target имеет смысл только при **идентичном наборе данных и одинаковом состоянии экрана**. Если draft показывает board-экран с 6 карточками, а target — info-экран с текстом, pixelmatch будет показывать 80%+ расхождений не из-за CSS, а из-за разного контента.

### 0.1. Разные источники данных

| Источник | Draft | Target |
|---|---|---|
| Данные | Static JSON fixtures (`screen_s1.json`, `screen_hint.json`) | Runtime API (`/api/runtime/sessions`, `/api/runtime/actions`) |
| Роутинг | Query-параметр `?fixture=screen_leftsidebar` | State-driven (intro → info → board) |

**Вывод:** нельзя просто открыть оба URL и сделать скриншот. Нужно привести оба приложения к одинаковому визуальному состоянию.

### 0.2. Стратегии выравнивания состояния

**A. Фикстуры в обоих приложениях (идеально)**
- Захардкодить в target тот же JSON, что использует draft.
- Или заставить draft работать через runtime API.

**B. API-продвижение target до состояния draft**
- Создать сессию через target API.
- Вызвать нужные action'ы (например, `advanceIntro`) для перехода от intro к board-экрану.
- Установить `localStorage.setItem('session-id', ...)` и перезагрузить страницу.
- Повторить клики по info-экранам ("Продолжить"), пока не появится target-экран.

**C. Screenshot на каждом шаге маршрута**
- Делайте скриншоты не только финального экрана, но и промежуточных (intro, info-i0, info-i1, ..., board).
- Так вы найдёте, на каком именно шаге расхождение впервые появляется.

### 0.3. Пример скрипта продвижения

```javascript
const res = await fetch('http://target/api/runtime/sessions', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ gameId: 'antarctica', playerId: 'player-web' })
});
const { sessionId } = await res.json();

// Advance past intro
await fetch('http://target/api/runtime/actions', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ sessionId, playerId: 'player-web', actionId: 'advanceIntro' })
});

// Playwright: set session and reload
await page.evaluate((sid) => {
  localStorage.setItem('cubica-antarctica-session-id', sid);
}, sessionId);
await page.reload({ waitUntil: 'networkidle' });
```

---

## 1. Подготовка автоматизированной сверки (Visual Diff)

**Инструменты:** Playwright + `pixelmatch` + `pngjs`

**Шаги:**
1. Установить Playwright: `npx playwright install chromium`
2. Создать скрипт, который:
   - Открывает оба приложения в одном и том же viewport (например, 1920×1080)
   - Проходит одинаковый сценарий взаимодействия (клики по кнопкам, ожидание сетевых запросов)
   - Делает скриншоты обоих экранов в одинаковом состоянии
   - Сравнивает пиксели через `pixelmatch`
   - Сохраняет diff-изображение и выводит процент расхождений

**Ключевые параметры pixelmatch:**
- `threshold: 0.1` — чувствительность к разнице цвета
- `includeAA: true` — учитывать антиалиасинг (для текста)

**Важный нюанс:** `pixelmatch` v7.1.0 полностью записывает diff-буфер (не только отличающиеся пиксели). Для подсчёта различий используй **возвращаемое значение** функции (количество diff-пикселей), а не анализ буфера.

---

## 2. Анализ DOM-структуры

Сравни HTML-структуру обоих экранов через DevTools или `page.evaluate()`:

- Какие элементы есть в draft, но нет в target?
- Есть ли в target скрытые элементы, которые влияют на layout (padding, margin, border)?
- Отличается ли тип тега (`<div>` vs `<article>`)?

**Пример:** target-рендерер использовал `<article>` с внутренними скрытыми элементами (`.antarctica-fallback-card-head`, `.antarctica-fallback-card-meta`, `.action-button`), которых не было в draft. Эти элементы создавали лишний whitespace — их нужно было скрыть через CSS.

---

## 3. Анализ CSS: поэтапное устранение расхождений

### 3.1. Глобальные стили (globals.css)

Проверь:
- `background` / `background-size` на корневом screen-элементе
- `grid-template-columns` / `grid-template-rows` — соответствуют ли draft?
- `font-family` / `font-size` — используется ли тот же шрифт с теми же subsets?

**Важно:** Разница в загрузке шрифтов (`next/font/google` с `subsets: ["latin"]` vs `["latin", "cyrillic"]`) влияет на метрики текста и может давать ~1% разницы в хедере.

### 3.2. Контейнер карточек (cards-container)

Проверь:
- `display: flex` vs `display: grid`
- `gap`, `padding`, `width`, `margin`
- `grid-row` / `grid-column` при использовании CSS Grid
- `align-content`, `align-items` — особенно важно для растягивания карточек

### 3.3. Стили карточек (.s1-card / .game-card)

Сравни:
- `padding`, `background-color`, `background-image`
- `border-radius`, `border`, `box-shadow`
- `color`, `font-weight`, `line-height`
- `min-height` / `max-height` — **частый источник расхождений**
- `width`, `flex-basis`

**Типичная проблема:** target имел `min-height: 234px` и `253px` для разных рядов карточек, draft — uniform. Решение: `min-height: auto !important`.

### 3.4. Навигационные кнопки (стрелки)

Проверь размеры:
- `width`, `height` (draft: 40×40, target: 56×56)
- `min-width`, `min-height`
- `border-radius` (draft: 0, target: 16px)

### 3.5. Контейнер кнопок (.button-container)

Проверь:
- `padding`, `gap`
- `width` (auto vs 100%)
- `position: relative` + `top` (target имел `top: -11px`, сдвигавший контейнер вверх)

### 3.6. Переменные и значения (variables)

Проверь:
- `color` на `.game-variable-value` — target мог иметь blanket override на `#fff`, а draft использовал разные цвета для разных типов переменных
- `text-shadow`

### 3.7. Overlay-элементы

Проверь наличие дополнительных overlay-элементов (`.additional-background` и т.п.), которые могут затемнять или перекрывать контент.

### 3.8. Stacking context в CSS Grid

**Частая причина неработающих кнопок на визуально идеальном экране.**

В CSS Grid элемент с явным `z-index: 0` создаёт **stacking context** и отрисовывается **поверх** соседних grid-элементов с `z-index: auto` (значение по умолчанию), даже если они позже в DOM.

**Пример из практики:**
```css
.additional-background {
  grid-column: 2;
  grid-row: 1 / 4;
  z-index: 0;        /* создаёт stacking context */
}
.button-container {
  grid-column: 2;
  grid-row: 3;
  /* z-index: auto по умолчанию — ниже stacking context! */
}
```
Результат: `.additional-background` перекрывает `.button-container`, кнопки визуально видны, но не кликабельны.

**Правильные фиксы:**
1. Декоративному overlay добавить `pointer-events: none` — клики проходят сквозь него, визуал не меняется.
2. Интерактивному контейнеру задать `z-index: 1` (как в draft), чтобы он был выше overlay в том же stacking context.

**Чего НЕ делать:** не меняйте `grid-row` / `grid-column` overlay или кнопок, чтобы "сдвинуть" их друг от друга — это сломает layout на других экранах (info, leftsidebar).

---

## 4. Применение фиксов через CSS overrides

Добавь в `apps/player-web/app/globals.css` (или аналогичный файл) специфичные override-правила с `!important`:

```css
/* Пример: выравнивание карточек */
.topbar-screen-shell .cards-container > .s1-card {
  padding: 1em !important;
  background-color: rgba(162, 217, 247, 0.5) !important;
  border-radius: 0 !important;
  border: none !important;
  box-shadow: none !important;
  color: #fff !important;
  font-weight: bold !important;
  line-height: 1.4 !important;
  min-height: auto !important;
}

/* Пример: скрытие лишних внутренних элементов */
.topbar-screen-shell .cards-container > .s1-card .antarctica-fallback-card-head,
.topbar-screen-shell .cards-container > .s1-card .antarctica-fallback-card-meta,
.topbar-screen-shell .cards-container > .s1-card .action-button {
  display: none !important;
}
```

---

## 5. Итеративная проверка

1. Запусти visual diff скрипт
2. Проанализируй diff-изображение (`diff-*.png`) — где именно остаются различия?
3. Для локализации создай диагностические скрипты (примеры в `draft/check-*.cjs`):
   - Сравнение пикселей в конкретной области (header, bottom)
   - Вывод computed styles через `page.evaluate()`
4. Примени фикс → перезапусти diff → повторяй, пока не достигнешь целевого процента

---

## 6. Критерий успеха

**Целевой показатель:** < 5% различий пикселей при сравнении скриншотов на одинаковом viewport (1920×1080).

При этом нормально, что ~1% остаётся из-за:
- Разницы в рендеринге шрифтов (subsets, hinting)
- Незначительных structural differences, которые нельзя устранить без изменения архитектуры target

---

## Диагностические скрипты

Созданы в процессе работы:

- `draft/visual-diff.js` — основной скрипт сравнения
- `draft/check-header-pixels.cjs` — анализ хедера
- `draft/check-bottom-pixels.cjs` — анализ нижней части
- `draft/check-header-bg.cjs` — семплирование цветов фона
- `draft/check-grid-row.cjs` — проверка computed styles через Playwright

---

## 7. Проверка кликабельности и интерактивности

Визуальное совпадение скриншотов (pixelmatch < 5%) **не гарантирует** работоспособность интерактивных элементов. Кнопки могут быть визуально видны, но перекрыты другим элементом (overlay, соседний grid-item, `position: relative` с отрицательным `top`), и тогда пользователь не сможет по ним кликнуть.

### 7.1. Почему Playwright `page.click()` даёт ложноположительный результат

`page.click('#btn-journal')` в Playwright автоматически:
1. Прокручивает элемент в видимую область
2. Вычисляет центр bounding box
3. Выполняет нативный клик по координатам

**Проблема:** если элемент перекрыт другим элементом с `pointer-events: auto`, Playwright всё равно кликнет по координатам, но событие `click` поймает перекрывающий элемент, а не кнопку. В тесте это выглядит как "успешный клик", но в UI ничего не происходит.

### 7.2. Правильная проверка через `elementFromPoint`

Перед кликом убедись, что элемент в точке его центра действительно является кнопкой:

```javascript
const isClickable = await page.evaluate((id) => {
  const btn = document.getElementById(id);
  if (!btn) return false;
  const rect = btn.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const topEl = document.elementFromPoint(cx, cy);
  return topEl === btn || btn.contains(topEl);
}, 'btn-journal');
```

Если `isClickable === false` — кнопка перекрыта.

### 7.3. Визуальная проверка перекрытия

Делай скриншот с подсвеченными границами подозрительных элементов:

```javascript
await page.evaluate(() => {
  document.querySelectorAll('#btn-journal, #btn-hint').forEach((b) => {
    b.style.outline = '4px solid red';
    b.style.zIndex = '9999';
  });
});
await page.screenshot({ path: 'buttons-debug.png' });
```

Если красная рамка не видна полностью — элемент перекрыт.

### 7.4. Проверяй именно тот экран, о котором сообщается

Если пользователь говорит "кнопки не работают на topsidebar экране", проверяй **intro-экран S1** (рендерится через `AntarcticaS1Renderer` из `ui.manifest.json`), а не fallback `info-screen-shell` (i0–i16). Это разные рендереры с разными DOM-структурами и CSS grid.

**Ключевое различие:**
- `topbar-screen-shell` (S1): `grid-template-rows: 15% 1fr auto` — 3 строки, кнопки в `.bottom-controls-container` внутри `main-content-area`
- `info-screen-shell` (fallback): `grid-template-rows: 90% 10%` — 2 строки, кнопки в `.button-container.antarctica-panel-buttons` вне `main-content-area`

### 7.5. Stacking context — скрытая причина неработающих кнопок

Даже если `elementFromPoint` и скриншоты выглядят нормально, кнопка может быть перекрыта **stacking context** overlay-элемента с `z-index: 0`.

**Как обнаружить:**
```javascript
const isOverlayBlocking = await page.evaluate((btnId) => {
  const btn = document.getElementById(btnId);
  const rect = btn.getBoundingClientRect();
  const topEl = document.elementFromPoint(
    rect.left + rect.width / 2,
    rect.top + rect.height / 2
  );
  // elementFromPoint вернёт элемент с НИЖНИМ z-index в том же stacking context,
  // но если overlay создаёт новый stacking context (z-index: 0),
  // он будет "выше" в paint order
  return topEl !== btn && !btn.contains(topEl);
}, 'btn-journal');
```

**Безопасный фикс:**
```css
.additional-background {
  pointer-events: none; /* клики проходят сквозь декоративный фон */
}
.button-container {
  z-index: 1; /* поверх overlay, совпадает с draft */
}
```

**Чего НЕ делать:** не меняйте `grid-row` или `position: relative + top: -11px`, чтобы "сдвинуть" кнопки из-под overlay — это сломает layout на других экранах (info, leftsidebar).

### 7.6. Чек-лист кликабельности

- [ ] `elementFromPoint` в центре кнопки возвращает саму кнопку
- [ ] Скриншот с `outline: 4px solid red` показывает кнопку полностью, без обрезки
- [ ] Кнопка реагирует на hover (если есть hover-стили)
- [ ] После клика UI меняется (открывается панель, срабатывает action)
- [ ] Проверка выполнена на том же экране, который использует пользователь
- [ ] Проверена отсутствие перекрытия через stacking context (`z-index: 0` overlay vs `z-index: auto` кнопки)

---

## 8. Продвижение до целевого состояния (State Reaching)

Для динамических приложений (игры, многошаговые формы, onboarding) **initial load** часто показывает intro-экран, а не тот UI, который нужно сверять. Скриншоты на стартовом экране бесполезны — нужно дойти до целевого состояния.

### 8.1. Почему это важно

В Антарктике target после `advanceIntro` показывает последовательность info-экранов (i0 → i1 → ... → board). Если сравнивать intro target с fixture draft (`screen_s1.json`), diff будет 90%+ не из-за CSS, а из-за разного контента.

### 8.2. Алгоритм достижения состояния

1. **Определи целевой экран** — board, journal, hint, info?
2. **Проверь, может ли draft показать его напрямую** — есть ли query-параметр `?fixture=screen_hint`?
3. **Для target используй API + Playwright:**
   - Создай сессию через API.
   - Вызови `advanceIntro` или эквивалент.
   - Программно кликай "Продолжить", пока не появится target-экран.
   - Делай скриншот только тогда.

### 8.3. Ловушки

- **Ложный positive `page.click()`:** на info-экране кнопка "Продолжить" работает, но если вы думаете, что уже на board-экране, ваш `page.click('#btn-journal')` промахнётся, и вы не заметите.
- **Разное количество info-экранов:** draft может показывать fixture сразу, target проходит 3 info-экрана. Скрипт должен дождаться появления нужных элементов (`.cards-container .s1-card`), а не просто подождать N секунд.
- **Асинхронные переходы:** после `advanceIntro` нужно подождать networkidle + несколько секунд на анимации, прежде чем скриншотить.

```javascript
// Пример: ждём board-экран до 12 попыток
for (let i = 0; i < 12; i++) {
  const cards = await page.$$('.cards-container .s1-card');
  if (cards.length >= 4) break;
  const continueBtn = await page.$('button:has-text("Продолжить")');
  if (continueBtn) {
    await continueBtn.click();
    await page.waitForTimeout(3000);
  } else break;
}
```

---

## 9. Дополнительные рекомендации по практике миграции

### 9.1. Сравнивай computed styles, а не только CSS-правила

Файлы `globals.css` содержат сотни правил с `!important`, наследованием, media queries и специфичностью селекторов. Чтобы понять, **что на самом деле применяется к элементу**, используй `window.getComputedStyle()` в Playwright, а не ручной анализ файла.

**Пример:** кнопка может иметь `z-index: auto` в файле, но `getComputedStyle` вернёт `z-index: 0`, потому что родитель создаёт stacking context. Или `min-height: 234px` может приходить не из `.s1-card`, а из `.cards-container > *`.

```javascript
const computed = await page.evaluate((selector) => {
  const el = document.querySelector(selector);
  const s = window.getComputedStyle(el);
  return {
    zIndex: s.zIndex,
    pointerEvents: s.pointerEvents,
    gridRow: s.gridRow,
    gridColumn: s.gridColumn,
    minHeight: s.minHeight,
    position: s.position,
  };
}, '.bottom-controls-container');
```

**Когда применять:** перед каждым фиксом сделайте "snapshot" computed styles для подозрительных элементов в draft и target. Сравните — различия покажут, какое CSS-правило нужно переопределить.

### 9.2. Региональный diff-heatmap вместо одного процента

Один процент расхождений (например, 4.2%) не говорит, **где** именно проблема. 4% могут быть равномерно распределены по шуму, или сосредоточены в одной зоне (например, footer с кнопками отличается на 80%, а всё остальное — на 0.1%).

**Подход:** разбейте скриншот на зоны и считайте diff для каждой отдельно.

| Зона | Координаты | Что проверяется |
|---|---|---|
| Header | y: 0–120 | Метрики, переменные |
| Cards | y: 120–780 | Карточки, их padding, radius, фон |
| Footer | y: 780–1080 | Кнопки, контейнеры, стрелки |
| Sidebar | x: 0–260 | Левый сайдбар (leftsidebar-экран) |

```javascript
function regionDiff(baseline, current, x, y, w, h) {
  const regionBaseline = baseline.slice(y * baseline.width * 4, (y + h) * baseline.width * 4);
  // ...pixelmatch на подмножестве пикселей
}
```

**Преимущество:** сразу видно, что "footer отличается на 35%" — значит, проблема в `.button-container`, а не в шрифтах.

### 9.3. Автоматическое определение текущего экрана

Не полагайтесь на `page.waitForTimeout(5000)` как на единственный способ дождаться нужного состояния. Используйте **DOM-проверку**, чтобы точно знать, на каком экране находится target.

```javascript
const detectScreen = await page.evaluate(() => {
  const screen = document.querySelector('.s1-screen');
  if (!screen) return 'unknown';
  if (screen.classList.contains('topbar-screen-shell')) {
    if (document.querySelector('.cards-container .s1-card')) return 'topbar-board';
    if (document.querySelector('.info-event-card')) return 'topbar-info';
    return 'topbar-empty';
  }
  if (screen.classList.contains('info-screen-shell')) return 'info-fallback';
  if (screen.classList.contains('journal-screen')) return 'journal';
  if (screen.classList.contains('leftsidebar-screen')) return 'leftsidebar';
  return screen.className;
});
console.log('Current screen:', detectScreen);
```

**Интеграция в visual diff:** перед каждым скриншотом проверяйте `detectScreen`. Если он не совпадает с ожидаемым (например, ожидали `topbar-board`, а получили `info-fallback`), пропустите скриншот и залогируйте ошибку. Так вы избежите сравнения несопоставимых состояний.

### 9.4. Фиксируй devicePixelRatio

Если draft и target запущены на разных мониторах или с разными флагами `--force-device-scale-factor`, один и тот же текст будет занимать разное количество пикселей, давая ~0.5–1.5% "шума" diff.

**Playwright:** явно задайте `deviceScaleFactor` при создании viewport.

```javascript
await page.setViewportSize({ width: 1920, height: 1080 });
// Дополнительно: deviceScaleFactor: 1 для воспроизводимости
```

Если на вашей машине DPR = 2 (Retina/HiDPI), а на CI = 1 — diff будет нестабилен. Зафиксируйте DPR = 1 для обоих приложений.

### 9.5. Диагностический скрипт до применения фикса

Перед каждым CSS-фиксом запускайте скрипт, который выводит состояние подозрительной зоны. Сохраняйте вывод — так вы сможете:
- Доказать, что фикс решает именно эту проблему, а не маскирует другую.
- Откатить фикс, если он сломал другие экраны.

**Минимальный диагностический шаблон:**

```javascript
// draft/check-*.cjs — шаблон
const diagnose = async (page, label) => {
  const info = await page.evaluate(() => ({
    screenClass: document.querySelector('.s1-screen')?.className,
    addBg: {
      pointerEvents: document.querySelector('.additional-background')
        ? window.getComputedStyle(document.querySelector('.additional-background')).pointerEvents
        : null,
    },
    btnJournal: {
      found: !!document.getElementById('btn-journal'),
      rect: document.getElementById('btn-journal')?.getBoundingClientRect(),
    },
  }));
  fs.writeFileSync(`diagnose-${label}.json`, JSON.stringify(info, null, 2));
};
```

**Используйте:** перед фиксом (`diagnose-before.json`), после фикса (`diagnose-after.json`), и после проверки других экранов (`diagnose-info.json`, `diagnose-leftsidebar.json`).

### 9.6. Stale dev server cache — скрытая причина "совсем другого UI"

Next.js dev server (`npx next dev`) ведёт собственную компиляционную кэш-память в директории `.next`, **независимую** от `npm run build`. Даже после внесения изменений в код и перезапуска `npm run build`, запущенный dev-сервер может продолжать отдавать старый скомпилированный bundle.

**Признаки проблемы:**
- Playwright-скрипты показывают один DOM (новый), а ручной скриншот в браузере — другой (старый)
- CSS-фиксы не применяются визуально, хотя код в файле изменён
- Элементы, которые должны быть скрыты (`display: none`), всё ещё видны
- Процессов `next dev` на порту больше одного (`ps aux | grep "next dev"`)

**Правильный способ полного перезапуска:**

```bash
# 1. Убить ВСЕ процессы dev-сервера на порту
fuser -k 3009/tcp
sleep 2

# 2. Запустить ровно один новый процесс
npx next dev -p 3009
```

**Почему `Ctrl+C` недостаточно:**
- `next dev` может оставить zombie-процессы (особенно при ошибках компиляции или при быстром перезапуске)
- Старый процесс продолжает держать порт и отдавать кэшированный bundle
- `npm run build` создаёт production-сборку, но не пересобирает dev-кэш

**Чек-лист после перезапуска:**
- [ ] `ps aux | grep "next dev"` показывает ровно один процесс
- [ ] `lsof -i :3009` показывает только текущий node-процесс
- [ ] В браузере выполнена **жёсткая перезагрузка** (`Ctrl+F5` или `Cmd+Shift+R`) — браузер тоже кэширует CSS/JS
- [ ] DevTools → Network → "Disable cache" включено (для дополнительной уверенности)
- [ ] DOM в DevTools соответствует актуальному коду (проверить через "Inspect element")

**Когда применять:**
- После ЛЮБЫХ изменений в компонентах или CSS, если визуальный результат не соответствует ожиданиям
- Перед запуском visual diff скрипта, чтобы гарантировать, что target отдаёт актуальный bundle
- Если пользователь сообщает, что "вижу совсем другой UI", чем в тестах

---

## Чек-лист

- [ ] Playwright скриншотит оба экрана в одинаковом состоянии
- [ ] **Оба приложения используют одинаковые данные / fixtures (раздел 0)**
- [ ] **Target доведён до целевого состояния через API/клики (раздел 8)**
- [ ] **Текущий экран определён автоматически (раздел 9.3)**
- [ ] pixelmatch показывает < 3% различий
- [ ] **Diff разбит по регионам — расхождение локализовано (раздел 9.2)**
- [ ] Diff-изображение визуально проверено — оставшиеся различия понятны и допустимы
- [ ] Все CSS-фиксы вынесены в отдельный блок в globals.css (для удобства удаления/рефакторинга)
- [ ] Внутренние hidden-элементы не ломают layout (проверено через computed styles)
- [ ] **Computed styles подозрительных элементов записаны в diagnose-before/after (раздел 9.5)**
- [ ] **Проверена кликабельность кнопок на правильном экране, включая stacking context (раздел 7)**
- [ ] **Overlay-элементы имеют `pointer-events: none` или `z-index` ниже интерактивных элементов**
- [ ] **DevicePixelRatio зафиксирован (раздел 9.4)**
- [ ] **Dev server перезапущен полностью (убит через `fuser -k PORT/tcp`), ровно один процесс (раздел 9.6)**

---

## Примечания

- Не изменяй архитектуру target-приложения (компоненты, state, routing)
- Фокусируйся только на визуальном виде — pixel-perfect parity
- Используй `!important` только в parity-CSS, чтобы не ломать существующие стили в других режимах
- Для каждого экрана (topbar, leftsidebar, journal, info) процедура повторяется отдельно
