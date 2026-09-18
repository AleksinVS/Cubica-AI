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

  /** Download the server-authoritative public gameplay journal */
  downloadJournal: "Скачать журнал",

  aiDebriefEntry: "Разбор партии",
  aiDebriefTitle: "Проверяемый разбор партии",
  aiDebriefDescription: "ИИ создаёт черновик только по публичному журналу. Ведущий проверяет его перед подтверждением.",
  aiDebriefClose: "Закрыть разбор",
  aiDebriefLoad: "Загрузка разбора...",
  aiDebriefEmpty: "Черновика пока нет. Запросите его после просмотра публичного журнала.",
  aiDebriefGenerate: "Создать черновик",
  aiDebriefRegenerate: "Создать новый черновик",
  aiDebriefGenerating: "Создаём черновик...",
  aiDebriefDraft: "Черновик",
  aiDebriefDraftCreated: "Новый черновик создан.",
  aiDebriefConfirmed: "Подтверждено",
  aiDebriefConfirmationSaved: "Вариант подтверждён.",
  aiDebriefFacts: "Факты из журнала",
  aiDebriefEvidenceBacked: "Каждый факт связан с событиями журнала.",
  aiDebriefInterpretations: "Возможные интерпретации",
  aiDebriefHypothesis: "Гипотеза",
  aiDebriefQuestions: "Вопросы для обсуждения",
  aiDebriefNoInterpretations: "Интерпретаций нет.",
  aiDebriefEvidence: "Событие журнала",
  aiDebriefOpenEvidence: "Открыть событие",
  aiDebriefLoadingEvidence: "Загрузка события...",
  aiDebriefEventHeading: "Событие журнала",
  aiDebriefEventType: "Тип события",
  aiDebriefEventSequence: "Порядковый номер",
  aiDebriefEventTime: "Время события",
  aiDebriefErrorEvidence: "Не удалось открыть это событие журнала. Черновик не изменён; откройте полный журнал.",
  aiDebriefProvenance: "Происхождение и границы",
  aiDebriefThroughEvent: "До события",
  aiDebriefJournalHash: "Хэш журнала",
  aiDebriefMethodology: "Версия методики",
  aiDebriefPrompt: "Версия промта",
  aiDebriefProvider: "Поставщик",
  aiDebriefModel: "Модель",
  aiDebriefTokens: "Токены (вход / выход / всего)",
  aiDebriefOutputHash: "Хэш результата",
  aiDebriefConfirm: "Подтвердить этот вариант",
  aiDebriefConfirming: "Подтверждаем...",
  aiDebriefErrorLoad: "Не удалось загрузить разбор. Проверьте соединение и повторите попытку.",
  aiDebriefErrorGenerate: "Не удалось создать черновик. Журнал и текущий вариант сохранены; повторите действие вручную.",
  aiDebriefErrorConfirm: "Не удалось подтвердить вариант. Журнал и черновик не изменены; повторите действие вручную.",
  aiDebriefRetryLoad: "Повторить действие",

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

  sessionSetupKicker: "Настройка сессии",
  sessionSetupTitle: "Кто участвует в игре?",
  sessionSetupDescription: "Выберите состав участников перед запуском. Настройку нельзя изменить после создания сессии.",
  participantCountLabel: "Количество участников",
  participantModeLabel: "Тип участников",
  humanOnlyChoice: "Только люди",
  agentSeatChoice: "Добавить ИИ-участника",
  privateInviteChoice: "Пригласить участников по ссылке",
  agentSeatCountLabel: "Количество ИИ-участников",
  startSession: "Начать игру",
  participantsTitle: "Участники",
  humanParticipant: "Человек",
  aiParticipant: "ИИ",
  agentControlKicker: "Управление ИИ-участником",
  agentPausedTitle: "Ход ИИ-участника приостановлен",
  agentPausedDescription: "Действия недоступны до восстановления сервиса. Повторите проверку состояния игры, когда сервис будет готов.",
  agentTakeoverTitle: "Управление передано ведущему",
  agentTakeoverDescription: "ИИ-участник не смог продолжить. Вы можете выполнить его обычное действие в этой сессии.",
  agentControlIntegrityTitle: "Состояние участника не удалось проверить",
  agentControlIntegrityDescription: "Действия заблокированы до получения корректного состояния от игрового сервера.",
  agentControlReasons: {
    runtimeUnavailable: "Сервис ИИ-агента недоступен.",
    invalidAttemptLimit: "ИИ-агент исчерпал допустимые попытки.",
    fallbackUnavailable: "Резервное действие недоступно.",
    stepLimit: "Достигнут предел шагов ИИ-участника."
  },
} as const;

export type LocaleKey = keyof typeof ru;
export type LocaleStrings = typeof ru;
