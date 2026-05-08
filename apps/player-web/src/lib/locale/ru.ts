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
} as const;

export type LocaleKey = keyof typeof ru;
export type LocaleStrings = typeof ru;