/**
 * Модуль sessionEvents описывает базовые типы и интерфейсы
 * для работы с очередью событий мультиплеера в Router.
 *
 * Здесь мы не реализуем реальные вызовы БД или LLM.
 * Цель этого файла — зафиксировать контракт:
 * какие данные хранит событие, как выглядит состояние сессии
 * и какие операции ожидаются от слоя работы с очередью.
 */

/**
 * SessionId, PlayerId и EventId — строковые идентификаторы сущностей.
 * В реальной системе это могут быть UUID, но для интерфейсов
 * достаточно строкового типа.
 */
export type SessionId = string;
export type PlayerId = string;
export type EventId = string;

/**
 * SessionEventStatus описывает возможные статусы события в очереди.
 * - pending: событие ожидает обработки;
 * - processing: событие взято в обработку;
 * - completed: событие успешно обработано;
 * - failed: событие окончательно завершилось с ошибкой.
 */
export type SessionEventStatus = 'pending' | 'processing' | 'completed' | 'failed';

/**
 * SessionEvent описывает единичное событие в очереди session_events.
 * Поля соответствуют расширенной схеме из ADR-011.
 */
export interface SessionEvent {
  id: EventId;
  sessionId: SessionId;
  playerId: PlayerId;
  sequence: number;
  actionId: string;
  payload: unknown;
  status: SessionEventStatus;
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
 * SessionEventQueuePort — это интерфейс (порт) для работы с очередью событий.
 * Конкретная реализация может использовать БД, внешнюю очередь или иной механизм,
 * но должна предоставлять описанные здесь операции.
 */
export interface SessionEventQueuePort {
  /**
   * Сохранить новое событие в очереди.
   * Реализация должна присвоить корректный sequence для данной сессии.
   */
  enqueue(event: Omit<SessionEvent, 'id' | 'sequence' | 'status' | 'attempts' | 'createdAt'>): Promise<SessionEvent>;

  /**
   * Найти следующее событие для обработки для указанной сессии
   * и перевести его в статус processing.
   *
   * Если ожидающих событий нет, вернуть null.
   */
  acquireNextPending(sessionId: SessionId): Promise<SessionEvent | null>;

  /**
   * Обновить статус события после обработки.
   * Должно использоваться для перевода события в completed или failed,
   * а также для инкремента attempts и установки errorCode.
   */
  updateStatus(eventId: EventId, status: SessionEventStatus, params?: { attempts?: number; errorCode?: string; processedAt?: Date }): Promise<void>;
}

/**
 * SessionStateRepositoryPort описывает операции над состоянием сессии,
 * связанные с применением событий.
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
   * в одной транзакции вместе с изменениями по событию.
   *
   * delta описывает изменения, которые вернул игровой движок.
   */
  applyEventDelta(params: {
    sessionId: SessionId;
    expectedVersion: SessionStateVersion;
    delta: unknown;
    event: SessionEvent;
  }): Promise<SessionStateVersion>;
}

