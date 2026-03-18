# Дизайн-артефакты Antarctica

Данный каталог содержит дизайн-артефакты игры Antarctica — изображения с JSON-описаниями, оптимизированные для работы ИИ-агентов.

## Структура каталога

```
design/
├── design-history.json    # История версий и граф связей артефактов
├── README.md              # Этот файл
├── references/            # Референсы из других продуктов
├── concepts/              # Концепты и мудборды
├── flowcharts/            # Схемы навигации и логики
├── wireframes/            # Структурные каркасы
├── storyboards/           # Раскадровки анимаций
├── mockups/               # Детальные макеты
└── assets/                # Готовые графические элементы
    ├── icons/
    └── backgrounds/
```

## Типы артефактов

| Тип | Описание |
|-----|----------|
| `reference` | Референс из другой игры/продукта |
| `concept` | Концептуальное изображение, скетч, мудборд |
| `flowchart` | Схема пользовательского пути или игровой логики |
| `wireframe` | Каркас (структурная схема без визуального оформления) |
| `storyboard` | Раскадровка переходов и анимаций |
| `mockup` | Детальный макет с финальным визуальным оформлением |
| `asset` | Готовый графический элемент (иконка, фон, персонаж) |

## Формат файлов

Каждый артефакт состоит из:
- Изображение (`.png`, `.jpg`, `.svg`)
- JSON-описание (`*.design.json`) с секциями:
  - `image` — параметры изображения
  - `generation` — промпты и параметры генерации
  - `regions` — семантическая разметка зон
  - `style_tokens` — дизайн-токены
  - `meta` — метаданные

## Ссылки

- [ADR-016: Дизайн-артефакты для ИИ-агентов](../../../docs/architecture/adrs/016-design-artifacts-in-ui-manifest.md)
- [Схема design-artifact.schema.json](../../../docs/architecture/schemas/design-artifact.schema.json)
- [Схема design-history.schema.json](../../../docs/architecture/schemas/design-history.schema.json)
- [Документация manifest-structure.md](../../../docs/architecture/schemas/manifest-structure.md)
