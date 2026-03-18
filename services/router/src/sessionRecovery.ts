/**
 * Модуль sessionRecovery описывает базовые структуры и интерфейсы
 * для работы с блокировками сессий и механикой восстановления (Session Recovery).
 *
 * Здесь фиксируется контракт, но не реализуются реальные вызовы к БД
 * или внешним сервисам. Это опорная точка для будущей реализации Router.
 */

import type { SessionId } from './sessionEvents';

/**
 * SessionLockStatus отражает состояние блокировки сессии:
 * - active: блокировка активна, ход обрабатывается;
 * - expired: TTL истёк, блокировка считается "мертвой";
 * - released: блокировка снята корректно после завершения хода.
 */
export type SessionLockStatus = 'active' | 'expired' | 'released';

/**
 * SessionLock описывает логическую блокировку сессии на время обработки хода.
 * Здесь фиксируется владелец блокировки, время начала и TTL (в миллисекундах).
 */
export interface SessionLock {
  sessionId: SessionId;
  lockId: string;
  ownerId: string;
  acquiredAt: Date;
  ttlMs: number;
  status: SessionLockStatus;
}

/**
 * SessionLockManagerPort задаёт интерфейс для менеджера блокировок.
 * Конкретная реализация может хранить данные в памяти, в БД или в Redis,
 * но должна соблюдать эти операции.
 */
export interface SessionLockManagerPort {
  /**
   * Попытаться захватить блокировку для сессии.
   * Если блокировки нет или она истекла по TTL, создаётся новая.
   * Если живая блокировка уже существует, метод может вернуть null.
   */
  acquireLock(params: { sessionId: SessionId; ownerId: string; ttlMs: number }): Promise<SessionLock | null>;

  /**
   * Продлить существующую блокировку (refresh TTL).
   * Используется длительными операциями для предотвращения
   * ложного срабатывания механизма dead lock detection.
   */
  refreshLock(lockId: string, ttlMs: number): Promise<SessionLock | null>;

  /**
   * Явно снять блокировку после завершения обработки хода.
   */
  releaseLock(lockId: string): Promise<void>;

  /**
   * Найти и пометить как просроченные все блокировки,
   * у которых TTL уже истёк относительно переданного момента времени.
   */
  markExpired(now: Date): Promise<SessionLock[]>;
}

/**
 * SessionRecoveryResult описывает результат процедуры восстановления.
 * Он нужен для того, чтобы Router мог вернуть пользователю понятное
 * сообщение или решить, можно ли повторить действие.
 */
export interface SessionRecoveryResult {
  sessionId: SessionId;
  recovered: boolean;
  reason: 'timeout' | 'internal_error';
  message: string;
}

/**
 * SessionRecoveryServicePort описывает интерфейс сервиса восстановления.
 * Он использует менеджер блокировок и репозиторий состояния сессии,
 * чтобы "разрулить" зависшие ходы и вернуть систему в устойчивое состояние.
 */
export interface SessionRecoveryServicePort {
  /**
   * Проверить состояние сессии и, при необходимости, выполнить восстановление.
   * Типичный сценарий:
   * - обнаружить просроченную блокировку (expired);
   * - убедиться, что в БД осталось согласованное состояние (checkpoint);
   * - снять блокировку и вернуть результат восстановления.
   */
  recoverIfStuck(sessionId: SessionId): Promise<SessionRecoveryResult | null>;
}

