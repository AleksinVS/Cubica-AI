# F_00041: JS Sandbox Security Specification

- **Эпик**: [E_0030](../epics/E_0030_backend_architecture_design.md)
- **Статус**: done
- **Приоритет**: Critical

## Описание
Детализация и спецификация безопасной среды исполнения JavaScript-скриптов (Hybrid Model).

## Проблема
ADR-007 декларирует использование Sandbox, но не определяет конкретные механизмы защиты от DoS (бесконечные циклы), исчерпания памяти и доступа к опасным API.

## Задачи
1.  Выбрать технологию изоляции (QuickJS, V8 Isolate, vm2 и т.д.) и обосновать выбор.
2.  Определить лимиты ресурсов (Memory Limit, CPU Timeout).
3.  Составить белый список доступных API (`std`, `state`, `args`).
4.  Обновить **ADR-007** с техническими деталями безопасности.

## Acceptance Criteria
- [x] Выбран Runtime для скриптов (`isolated-vm`).
- [x] Зафиксированы лимиты (100ms Timeout, 128MB Memory).
- [x] Сформирован Threat Model (модель угроз) для скриптового движка (см. ADR-010).
- [x] Создан **ADR-010: JS Sandbox Security Strategy**.

