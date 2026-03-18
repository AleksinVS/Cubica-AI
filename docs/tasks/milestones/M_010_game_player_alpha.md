---
id: M_010
title: Alpha-этап игрового плеера
status: planned
owner: @todo
due: 2025-12-31
tags: [release]
links:
  - docs/tasks/brief.md
---

# MILESTONE: Alpha-этап игрового плеера

## Цели
- [ ] E-25-0001: Архитектура JSON-манифестов игр и LLM-first плеера (epics/E-25-0001-game-manifest-architecture.md)
- [ ] E-25-0002: Перенос сценария «Antarctica» на Next.js-плеер на основе новой архитектуры манифестов (epics/E_0020_antarctica_nextjs_game_player.md)

## Эпики и зависимости
- [E-25-0001: Архитектура JSON-манифестов игр и LLM-first плеера](../epics/E_0010_game_manifest_architecture.md)
- [E-25-0002: Antarctica на Next.js game player](../epics/E_0020_antarctica_nextjs_game_player.md)

## Ожидаемые Deliverables
- [ ] Базовый формат JSON‑манифестов игр и схем, задокументированный и согласованный (E_0010/F_00010)
- [ ] Черновой, но проходимый сценарий «Antarctica» в Next.js-приложении `games/antarctica-nextjs-player`, реализованный как JSON‑манифест в новой архитектуре (E_0020/F_00020)

## Риски и допущения
- Риск: исходный HTML-прототип содержит «монолитную» логику, которую не удастся один-в-один перенести в целевую схему без упрощений.
- Допущение: `draft/Antarctica/Game.html` остаётся источником правды по игровым правилам и текстам до появления отдельного backend-движка.

## Definition of Done
- [ ] Игровой сценарий «Antarctica» запускается через Next.js-плеер и позволяет пройти хотя бы базовый путь
- [ ] Документация по сценариям и плееру обновлена (Epic/Feature, ExecPlan)
- [ ] ROADMAP.md синхронизирован с состоянием milestone
- [ ] CI/линтеры для `games/antarctica-nextjs-player` выполняются успешно (если добавлены)
