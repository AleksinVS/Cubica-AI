# Предложение по устранению находок ревью 2026-08-31

## Принцип

Не перестраивать платформу целиком. Сначала восстановить уже принятые
инварианты и контрольные ворота, затем отдельно согласовать только те пункты,
где действительно меняются публичный контракт, trust boundary, хранение или
коммерческая модель.

Канонический исполнительский план находится в
`docs/tasks/active/TSK-20260831-project-review-remediation.md`. Этот документ
фиксирует исходную приоритизацию и не ведёт второй статус исполнения.

## Очерёдность

1. **R0 — вернуть зелёную честную базовую линию:** F-002 и F-044; добавить
   Portal -> Runtime contract test и включить CMT mock/provenance в подходящий
   affected gate.
2. **R1 — остановить потерю данных и пересечение сессий:** F-001, F-003,
   F-004, F-005, F-006, F-007, F-018, F-037.
3. **R2 — закрыть runtime/client trust leaks:** F-013, F-014, F-017,
   F-019, F-020, F-028, F-029, F-035, F-038, F-040.
4. **R3 — восстановить единые источники истины:** F-008, F-015, F-016,
   F-023, F-024, F-025, F-041, F-042, F-043, F-045, F-046, F-048.
5. **R4 — устранить state/lifecycle и UX-дефекты:** F-009, F-010, F-011,
   F-012, F-021, F-022, F-030, F-036, F-039, F-049.
6. **R5 — исполнить принятые решения PM:** F-026, F-027, F-031, F-032,
   F-033, F-034, F-047 и документационную синхронизацию D-001..D-012.

R0 и независимые fail-closed части R1 можно начинать до решений PM. Потоки
Portal payments/resume, Cubica Surface compatibility, hybrid degradation,
preview origin trust и debrief semantics не переходят к реализации до
решения из `architecture-decisions.md`.

## Границы потоков

| Поток | Владение | Риск и рекомендуемая роль | Главная проверка |
| --- | --- | --- | --- |
| W1 Editor lease/mutations/GC | `apps/editor-web` session, lease, mutating routes, cleanup | Concurrency/data loss; Sol-high design and critical implementation, независимое review | Межпроцессные negative tests + Editor focused suite |
| W2 Preview trust/messages | Runtime preview routes, preview message schema/OpenAPI + Editor/Player bridge | Security/cross-app boundary; Sol-high; единственный integration owner этой точной shared-границы | Symlink/cross-session/hash/origin negative corpus + E2E preview |
| W3 Portal | Portal/Runtime launch contract и его OpenAPI, payments, binding | Payments/transactions/public contract; Sol-high after PM decisions; единственный integration owner launch-границы | Real Runtime contract test, DB concurrency/transaction tests, route inventory |
| W4 Runtime/Mechanics/contracts | Admission, budgets, road calculation и shared contracts вне W2/W3 | High shared boundary; Sol-high architecture, bounded executor after fixed plan | Runtime focused suites, schema parity, API inventory, neutral fixtures |
| W5 Player/game packages | Outbox/SSE/plugins/renderers/CMT mock/debrief UI; shared schemas только после handoff | Mostly bounded non-critical implementation; Luna executor -> focused tests -> optional Luna-xhigh preliminary critic -> primary Sol-high acceptance. Сравнение с визуальным эталоном — Sol-high critical review; без эталона — primary Sol-high acceptance. | Player/CMT tests, build, browser negative flows |
| W6 Product Context/operations/CI | Lease fencing, streaming bounds, supervisor, selectors/validators | Mixed; split high concurrency/ops from mechanical gates | Focused integration tests + isolation/affected self-tests |
| W7 Architecture synchronization | ADR status/summary and bounded debt | Architecture; primary Sol-high, PM only for unresolved choices | ADR link/status audit, `verify:legacy`, instruction/structure checks |

Параллельное исполнение допускается только между потоками с разными файлами.
W2 владеет Runtime preview routes/schema/OpenAPI, W3 — Portal/Runtime launch
contract/OpenAPI, W4 — остальными Runtime/Mechanics contracts. W5 является
потребителем action/surface contract и не пишет shared schema до handoff.
Зависимый поток начинает запись только после передачи head SHA и bounded
Sol-high gate; перед записью единственный `exclusive`-владелец точной границы
публикуется в `NEXT_STEPS.md`.

## Проверка на упрощение

- Не вводить новый service, queue, cache, schema dialect или общий framework.
- Не создавать отдельный исполнитель для preview/confirm: F-016 устраняется
  выделением одной чистой функции расчёта, вызываемой обоими путями.
- Не вводить новую таблицу аренды, если уникальный токен безопасно помещается
  в существующее поле и это доказывается тестом.
- Не хранить raw Runtime bearer в Portal ради resume; решение должно
  переиспользовать credential-holding BFF либо узкий claim/reissue контракт.
- Не создавать по TSK на каждую находку. Дочерняя задача нужна только для
  отдельной ветки/приёмки или передачи между сессиями.
- Не переносить все 49 пунктов в `debt-log.csv`: активный TSK уже является
  планом снятия. В долг попадает только явно отложенный PM остаток с триггером
  удаления и владельцем.

## Этапная приёмка

Этапная приёмка — не повторное ревью всего репозитория. После законченного
потока проверяются только его diff, затронутые контракты и потребители,
сфокусированные тесты и перечисленные отрицательные сценарии. Полный
`verify:canonical` запускается один раз на интеграционной базовой линии после
сведения крупных потоков либо раньше, если изменён shared contract/CI gate и
узких доказательств недостаточно.
