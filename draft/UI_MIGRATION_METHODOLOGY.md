# Методика точной миграции UI из draft/game-player-nextjs

## Проблема

ИИ-агент не может точно воспроизвести UI по скриншотам, потому что:
1. Playwright MCP по умолчанию передает accessibility tree (текстовые метки), а не визуальные данные
2. Агент не видит цвета, отступы, размеры шрифтов, позиционирование
3. Скриншоты + vision model дают приблизительное понимание, но не точные CSS-значения

## Решение: программное извлечение стилей + structured migration

### Шаг 1. Извлечь design tokens и computed styles

Запустить черновик и извлечь точные CSS-значения через Playwright:

```javascript
const tokens = await page.evaluate(() => {
  const elements = document.querySelectorAll('*');
  const computedStyles = [];
  elements.forEach(el => {
    const styles = window.getComputedStyle(el);
    computedStyles.push({
      color: styles.color,
      fontFamily: styles.fontFamily,
      fontSize: styles.fontSize,
      padding: styles.padding,
      margin: styles.margin,
      backgroundColor: styles.backgroundColor,
      // ...
    });
  });
  return deduplicateAndTokenize(computedStyles);
});
```

Или использовать готовые инструменты:
- `npx dembrandt https://localhost:3000 --dtcg --save-output` — извлекает W3C DTCG design tokens
- `npx designlang https://localhost:3000 --full` — извлекает токены и генерирует конфиги для Tailwind, CSS, shadcn/ui

### Шаг 2. Зафиксировать спецификацию

Сохранить извлеченные цвета, шрифты, отступы, breakpoints в файл `ui-spec.json`.

### Шаг 3. Дать агенту структуру, а не картинку

Вместо: «Сделай как на скриншоте»  
Дать: список точных CSS-значений + DOM-структура из черновика.

### Шаг 4. Pixelmatch feedback loop

После каждой итерации сравнивать скриншоты через `pixelmatch` или `looks-same`. Результат (`diff.png` + координаты отличающихся пикселей) скармливать агенту как конкретную задачу.

### Шаг 5. Perfect Web Clone (альтернатива)

Для максимально точной миграции использовать [Perfect Web Clone](https://github.com/adrianlIl/Perfect-Web-Clone) — multi-agent архитектура с 40+ инструментами, которая извлекает реальный DOM и CSS-правила через Playwright, а не интерпретирует пиксели.

## Применение к текущему проекту

Целевой проект (`apps/player-web`) уже имеет рендерер `antarctica-player.tsx` с поддержкой `topbar` и `leftsidebar` режимов, журнала и info-экранов. Миграция сводится к обновлению CSS в `globals.css` и, при необходимости, UI-манифеста (`games/antarctica/ui/web/ui.manifest.json`), без изменения архитектуры React-компонентов.

### Целевые экраны для миграции:

1. **Основная страница (topbar)** — экран S1 с верхним сайдбаром и 6 карточками
2. **Основная страница (leftsidebar)** — экран с левым сайдбаром и 6 карточками
3. **Журнал ходов** — экран J с двумя колонками карточек и метриками
4. **Info-страница** — экран с иллюстрацией и текстом

### Источник правды для стилей:

- `draft/game-player-nextjs/src/app/globals.css` — основные CSS-правила
- `draft/game-player-nextjs/src/app/components/gameComponents/*.js` — компоненты со inline-стилями
- `draft/game-player-nextjs/src/app/data/screen_*.json` — JSON-фикстуры с cssInline для каждого экрана
