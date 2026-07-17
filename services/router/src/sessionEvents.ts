/**
 * Модуль sessionEvents описывает базовые типы и интерфейсы будущей очереди
 * команд мультиплеера в Router.
 *
 * Здесь мы не реализуем реальные вызовы БД или LLM.
 * Цель этого файла — зафиксировать контракт:
 * какие данные хранит команда, как выглядит состояние сессии
 * и какие операции ожидаются от слоя работы с очередью.
 */

/**
 * Идентификаторы сессии, principal и элемента очереди — строки.
 * В реальной системе это могут быть UUID, но для интерфейсов
 * достаточно строкового типа.
 */
export type SessionId = string;
export type SessionPrincipalId = string;
export type SessionCommandQueueItemId = string;

/**
 * SessionCommandQueueStatus описывает возможные статусы команды в очереди.
 * - pending: команда ожидает обработки;
 * - processing: команда взята в обработку;
 * - completed: команда успешно обработана;
 * - failed: команда окончательно завершилась с ошибкой.
 */
export type SessionCommandQueueStatus = 'pending' | 'processing' | 'completed' | 'failed';

/**
 * SessionCommandQueueItem описывает команду в будущей очереди
 * `session_command_queue`. Это не подтверждённый игровой факт и не запись
 * защищённого журнала `session_events`.
 */
export interface SessionCommandQueueItem {
  id: SessionCommandQueueItemId;
  sessionId: SessionId;
  principalId: SessionPrincipalId;
  sequence: number;
  commandId: string;
  actionId: string;
  expectedStateVersion: number;
  params: Readonly<Record<string, unknown>>;
  status: SessionCommandQueueStatus;
  attempts: number;
  errorCode?: string;
  createdAt: Date;
  processedAt?: Date;
}

/**
 * SessionStateVersion хранит информацию о версии состояния сессии.
 * Значения должны соответствовать полям state_version и last_event_sequence
 * в таблице game_sessions.
 */
export interface SessionStateVersion {
  sessionId: SessionId;
  stateVersion: number;
  lastEventSequence: number;
}

/**
 * SessionCommandQueuePort — это интерфейс (порт) для работы с очередью команд.
 * Конкретная реализация может использовать БД, внешнюю очередь или иной механизм,
 * но должна предоставлять описанные здесь операции.
 */
export interface SessionCommandQueuePort {
  /**
   * Сохранить новую команду в очереди после аутентификации principal.
   * Реализация должна присвоить корректный sequence для данной сессии.
   */
  enqueue(command: Omit<SessionCommandQueueItem, 'id' | 'sequence' | 'status' | 'attempts' | 'createdAt'>): Promise<SessionCommandQueueItem>;

  /**
   * Найти следующую команду для обработки для указанной сессии и перевести её
   * в статус processing.
   *
   * Если ожидающих событий нет, вернуть null.
   */
  acquireNextPending(sessionId: SessionId): Promise<SessionCommandQueueItem | null>;

  /**
   * Обновить статус команды после обработки.
   * Должно использоваться для перевода команды в completed или failed,
   * а также для инкремента attempts и установки errorCode.
   */
  updateStatus(itemId: SessionCommandQueueItemId, status: SessionCommandQueueStatus, params?: { attempts?: number; errorCode?: string; processedAt?: Date }): Promise<void>;
}

/**
 * SessionStateRepositoryPort описывает операции над состоянием сессии,
 * связанные с применением команд.
 */
export interface SessionStateRepositoryPort {
  /**
   * Получить текущее состояние и версию сессии.
   * Конкретный формат state определяется игровой логикой,
   * поэтому здесь используется тип unknown.
   */
  getState(sessionId: SessionId): Promise<{ state: unknown; version: SessionStateVersion }>;

  /**
   * Применить дельту состояния и обновить версию сессии
   * в одной транзакции вместе с изменениями по команде.
   *
   * delta описывает изменения, которые вернул игровой движок.
   */
  applyCommandDelta(params: {
    sessionId: SessionId;
    expectedVersion: SessionStateVersion;
    delta: unknown;
    command: SessionCommandQueueItem;
  }): Promise<SessionStateVersion>;
}
