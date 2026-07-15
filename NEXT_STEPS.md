# Next Steps

Текущая доска проекта. Стратегические направления описаны в `docs/tasks/STRATEGY.md`, подробные планы ведутся в `docs/tasks/active/`, а завершенные задачи сохраняются в `docs/tasks/archive/`.

## Оглавление

- [Правило выбора работы](#правило-выбора-работы)
- [Общий план ближайших работ](#общий-план-ближайших-работ)
- [Now](#now)
- [Next](#next)
- [Later](#later)
- [Blocked](#blocked)
- [Canonical Context](#canonical-context)

## Правило выбора работы

1. Сначала брать задачи из `Now`.
2. Если нужно выбрать между направлениями, свериться с `docs/tasks/STRATEGY.md`.
3. Если задача требует архитектурного решения, сначала проверить или создать ADR.
4. Каждая активная работа должна иметь корневой `TSK-*`; самостоятельные результаты могут оформляться дочерними `TSK-*`.
5. В конце каждой остановки обновлять `Handoff Log` активной задачи.

## Общий план ближайших работ

Эти три шага сохраняют пункты 5–7 ближайшего плана из архитектурного ревью.

1. **Защита `main` временно отключена — `LEGACY-0043`.** По прямому решению PM защита снята на период объединения `draft-trains`. Пять CI-проверок продолжают запускаться, но временно не являются техническим запретом прямого push или merge. После завершения временного периода защиту нужно восстановить и закрыть запись в `docs/legacy/debt-log.csv`.
2. **Получить вводные PM по первой игре.** Достаточно описать цель, основной игровой цикл, участников, условие завершения и ожидания от интерфейса, ИИ, сохранения, сети и ресурсов. Технические форматы и архитектурные выводы подготовит агент.
3. **Выбрать один вертикальный срез.** На основе вводных агент выбирает один полностью запускаемый и проверяемый сценарий, создает корневой `TSK-*` и включает в него результат для игрока, карту архитектурного влияния, необходимые платформенные доработки и критерии приемки.

До выбора среза перечисленные ниже платформенные задачи рассматриваются как кандидаты. Они не образуют обязательную последовательность и активируются только по потребности выбранной игры или по отдельному приоритету PM.

## Now

- [TSK-20260711-cards-money-trains-game](docs/tasks/active/TSK-20260711-cards-money-trains-game.md) — `in_progress`: общий schema-first режим `map-first`, полнооконная авторская WebP-карта, закрываемые слои ведущего и камера реализованы. Серверное построение дороги с минимумом региональных сегментов также реализовано и проверено на нейтральной фикстуре и mock-игре: сервер сохраняет ломаную, версию геометрии, объяснимую стоимость и воспроизводимый случайный выбор равного маршрута. Нормативное подключение ждёт классификации и подтверждения реальных контуров; параллельно нужны четыре подтверждения сети, импорт 174 грузовых строк, 34 новостей и стран, а также закрытие жизненного цикла строительства `N+2`.
- [TSK-20260705-board-game-platform-capabilities](docs/tasks/active/TSK-20260705-board-game-platform-capabilities.md) — `in_progress`: участники, воспроизводимый бросок, ход, движение, проекция и минимальная экономика для GSR-034 реализованы; остальной пакет не реализуется заранее.
- [TSK-20260518-session-persistence-hardening](docs/tasks/active/TSK-20260518-session-persistence-hardening.md) — `review`: PostgreSQL-хранилище, блокировка одновременных ходов, проверка готовности и восстановление после рестарта реализованы и проверены на PostgreSQL 17.
- [TSK-20260705-monopoly-classic-game](docs/tasks/active/TSK-20260705-monopoly-classic-game.md) — `in_progress`: первый локальный срез Estate Race завершён и прошёл браузерную приёмку; полная классическая игра не завершена и продолжится последовательными GSR.
- [TSK-20260706-game-asset-channel](docs/tasks/active/TSK-20260706-game-asset-channel.md) — `review`: реестр, проверки, контент-адресуемая раздача и player/Phaser resolver реализованы первым игровым срезом; миграция LEGACY-0023 остается отдельной.
- [TSK-20260518-portal-test-vps-and-antarctica-launch](docs/tasks/active/TSK-20260518-portal-test-vps-and-antarctica-launch.md) — `in_progress`: отдельный трек portal launch surface и тестового VPS; не является автоматическим следующим шагом перед первой игрой.
- [TSK-20260520-project-review-remediation](docs/tasks/active/TSK-20260520-project-review-remediation.md) — `review`: исправления майского ревью реализованы и ожидают приемки.

## Next

- [TSK-20260713-project-knowledge-system](docs/tasks/active/TSK-20260713-project-knowledge-system.md) — `planned`: внедрить принятую ADR-082 проектную вики, постоянный граф знаний, FTS5, сразу доступный для явных запросов и сравнительной оценки векторный поиск, производную карту модулей и обязательный слой символов и происхождения контрактов; иерархия вызовов — список вызывающих и вызываемых функций — вычисляется по запросу, режим поиска по умолчанию выбирается при приёмке первой версии по измеримому качеству с FTS как начальным резервом, существующий генератор структуры сохраняется.
- [TSK-20260705-multiplayer-runtime-realization](docs/tasks/active/TSK-20260705-multiplayer-runtime-realization.md) — `planned`: кандидат на постоянные сессии, участников, события и WebSocket-доставку по потребности игрового среза.
- [TSK-20260706-flow-simulation-platform-capabilities](docs/tasks/active/TSK-20260706-flow-simulation-platform-capabilities.md) — `planned`: кандидат на общие возможности симуляций реального времени, если их потребует выбранная игра.
- [TSK-20260707-player-web-bundle-budget](docs/tasks/active/TSK-20260707-player-web-bundle-budget.md) — `planned`: кандидат на CI-бюджет first-load JavaScript по триггеру игрового среза или приоритету PM.
- [TSK-20260518-contracts-neutrality-cleanup](docs/tasks/active/TSK-20260518-contracts-neutrality-cleanup.md) — `planned`: убрать игровые детали из общих контрактов.
- [TSK-20260518-runtime-repository-boundary-and-readiness](docs/tasks/active/TSK-20260518-runtime-repository-boundary-and-readiness.md) — `planned`: укрепить границу репозитория контента и readiness.

## Later

- Заменить local-file game repository adapter на конфигурируемую repository boundary.
- Проработать production-контуры наблюдаемости, доступа, развертывания, лицензий, каталога и реального LLM provider adapter из реестра долга.
- Декомпозировать рендерер на «ядро + жанровые UI capability packs» только при срабатывании принятых триггеров бюджета или каналов доставки.
- Составить межтрековую карту очередности для общих точек `PhaserSceneContext`, runtime HTTP API и PRNG-модуля.
- Создать отдельную задачу целевого анализа потоков данных после инвентаризации
  источников и приёмников на конкретной границе безопасности; не строить общий
  граф значений без такого измеримого сценария.

## Blocked

- [TSK-20260705-agent-controlled-players](docs/tasks/active/TSK-20260705-agent-controlled-players.md) — `blocked`: ожидает turn-flow платформы.
- [TSK-20260706-conveyor-mini-game](docs/tasks/active/TSK-20260706-conveyor-mini-game.md) — `blocked`: ожидает платформенные фазы flow-simulation и общие эффекты метрик.
- [TSK-20260706-rail-tycoon-mini-game](docs/tasks/active/TSK-20260706-rail-tycoon-mini-game.md) — `blocked`: ожидает PRNG, общие эффекты, Phaser-host и канал ассетов.

## Canonical Context

- `games/antarctica/game.manifest.json` — источник истины исполнимой логики Antarctica.
- `games/simple-choice/` — минимальная вторая deterministic игра для game-agnostic runtime/player path.
- `games/ai-driven-choice/` — минимальная AI-driven fixture-игра для Agent Runtime и contract gates.
- `services/runtime-api/` — канонический backend runtime в формате модульного монолита.
- `apps/player-web/` — канонический web delivery layer.
- `packages/contracts/*` и `packages/view-protocol/` — общие контракты и framework-agnostic клиентский шов.
- `docs/architecture/PROJECT_ARCHITECTURE.md` — достаточная общая выжимка активной архитектуры и связей ADR.
- `draft/*` — исторические или визуальные references, не runtime source of truth.
