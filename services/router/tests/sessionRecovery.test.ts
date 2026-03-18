/**
 * Тесты для sessionRecovery демонстрируют базовую работу
 * с TTL блокировок и процедурой восстановления.
 *
 * Это не полноценные unit-тесты, а "smoke"-пример, который
 * показывает, как может использоваться SessionLockManagerPort
 * и SessionRecoveryServicePort.
 */

import type { SessionId } from '../src/sessionEvents';
import type {
  SessionLock,
  SessionLockManagerPort,
  SessionLockStatus,
  SessionRecoveryResult,
  SessionRecoveryServicePort,
} from '../src/sessionRecovery';

class InMemorySessionLockManager implements SessionLockManagerPort {
  private locks = new Map<string, SessionLock>();

  async acquireLock(params: { sessionId: SessionId; ownerId: string; ttlMs: number }): Promise<SessionLock | null> {
    const existing = Array.from(this.locks.values()).find(
      (lock) => lock.sessionId === params.sessionId && lock.status === 'active',
    );

    if (existing) {
      const now = Date.now();
      const expiresAt = existing.acquiredAt.getTime() + existing.ttlMs;
      if (now < expiresAt) {
        return null;
      }
    }

    const lockId = `lock-${Date.now()}`;
    const lock: SessionLock = {
      sessionId: params.sessionId,
      lockId,
      ownerId: params.ownerId,
      acquiredAt: new Date(),
      ttlMs: params.ttlMs,
      status: 'active' as SessionLockStatus,
    };
    this.locks.set(lockId, lock);
    return lock;
  }

  async refreshLock(lockId: string, ttlMs: number): Promise<SessionLock | null> {
    const lock = this.locks.get(lockId);
    if (!lock || lock.status !== 'active') {
      return null;
    }
    lock.ttlMs = ttlMs;
    lock.acquiredAt = new Date();
    return lock;
  }

  async releaseLock(lockId: string): Promise<void> {
    const lock = this.locks.get(lockId);
    if (lock) {
      lock.status = 'released';
    }
  }

  async markExpired(now: Date): Promise<SessionLock[]> {
    const expired: SessionLock[] = [];
    for (const lock of this.locks.values()) {
      if (lock.status !== 'active') {
        continue;
      }
      const expiresAt = lock.acquiredAt.getTime() + lock.ttlMs;
      if (expiresAt <= now.getTime()) {
        lock.status = 'expired';
        expired.push(lock);
      }
    }
    return expired;
  }
}

class SimpleSessionRecoveryService implements SessionRecoveryServicePort {
  constructor(private readonly lockManager: SessionLockManagerPort) {}

  async recoverIfStuck(sessionId: SessionId): Promise<SessionRecoveryResult | null> {
    const now = new Date();
    const expiredLocks = await this.lockManager.markExpired(now);
    const target = expiredLocks.find((lock) => lock.sessionId === sessionId);

    if (!target) {
      return null;
    }

    await this.lockManager.releaseLock(target.lockId);

    return {
      sessionId,
      recovered: true,
      reason: 'timeout',
      message:
        'Предыдущий ход не был завершён из-за превышения времени обработки. Сессия восстановлена из последнего устойчивого состояния.',
    };
  }
}

// Простейший smoke-тест. В реальном проекте будет интегрирован в Jest/Mocha.
async function smokeRecoveryTest() {
  const lockManager = new InMemorySessionLockManager();
  const recoveryService = new SimpleSessionRecoveryService(lockManager);

  const sessionId: SessionId = 'session-recovery-test';
  const ownerId = 'router-instance-1';

  const lock = await lockManager.acquireLock({ sessionId, ownerId, ttlMs: 10 });
  if (!lock) {
    throw new Error('Не удалось захватить блокировку для тестовой сессии');
  }

  // Ждём дольше TTL, чтобы блокировка стала кандидатом на истечение.
  await new Promise((resolve) => setTimeout(resolve, 20));

  const result = await recoveryService.recoverIfStuck(sessionId);
  if (!result || !result.recovered) {
    throw new Error('Ожидалось, что сессия будет восстановлена после истечения TTL блокировки');
  }
}

smokeRecoveryTest().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('SessionRecovery smoke test failed', error);
});

