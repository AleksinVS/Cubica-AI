/**
 * Russian locale strings for game UI.
 *
 * Centralizes all user-facing text so that:
 * - Localization is a single-file change (add a new locale file)
 * - AI agents can find and modify UI text without searching TypeScript components
 * - Manifest-driven screens carry their own text (via richTextComponent, buttonComponent)
 *   so this file only affects SafeModeRenderer fallback text and panel labels
 */

export const ru = {
  /** Loading indicator */
  loading: "Загрузка...",

  /** Retry button label */
  retry: "Повторить",

  /** Runtime dependency state label */
  runtimeStatusKicker: "Состояние запуска",

  /** AI-driven game is paused by declared failure policy */
  runtimePausedTitle: "Игра поставлена на паузу",

  /** AI-driven game can be retried by the player */
  runtimeRetryTitle: "Ожидаем сервис ИИ-агента",

  /** Runtime dependency is unavailable */
  runtimeUnavailableTitle: "Запуск недоступен",

  /** AI-driven game requires an agent backend before a session can start */
  runtimeAgentRequiredDescription: "Для этой игры нужен серверный ИИ-агент. Он сейчас не готов, поэтому сессия не создаётся.",

  /** Generic runtime unavailable description */
  runtimeGenericUnavailableDescription: "Игровой сервер сейчас не готов принять сессию.",

  /** Failure policy label */
  runtimeFailurePolicy: "Политика отказа",

  /** Card selection button label */
  selectCard: "Выбрать",

  /** Panel button: move history */
  journal: "журнал ходов",

  /** Panel button: hint */
  hint: "подсказка",

  /** Navigation: back */
  back: "Назад",

  /** Navigation: forward */
  forward: "Вперед",

  /** Advance/continue button (info screens) */
  continue: "Продолжить",

  /** Info screen default title */
  information: "Информация",

  /** Team selection default title */
  teamSelection: "Выбор команды",

  /** Team selection confirm button */
  confirm: "Подтвердить",

  /** Fallback screen notice */
  fallbackNotice: "Экран еще не описан в UI manifest, поэтому доступен безопасный runtime fallback.",

  /** Journal overlay heading */
  journalHeading: "Журнал ходов",

  /**
   * Entry-point kicker shown above the "missing gameId" error title.
   * "Точка входа" (entry point) is the generic Next.js route that boots any
   * game; it stays game-agnostic on purpose (CLAUDE.md rule 10) and must not
   * name a concrete game.
   */
  entryMissingGameIdKicker: "Точка входа плеера",

  /** Entry-point error title shown when the URL has no ?gameId= query parameter */
  entryMissingGameIdTitle: "Не указан идентификатор игры",

  /** Entry-point error description explaining how to fix the URL */
  entryMissingGameIdDescription:
    "Добавьте параметр ?gameId=<идентификатор игры> к адресу страницы, чтобы запустить игру.",
} as const;

export type LocaleKey = keyof typeof ru;
export type LocaleStrings = typeof ru;
