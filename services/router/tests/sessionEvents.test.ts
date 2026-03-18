/**
 * Тесты для модуля sessionEvents проверяют, что
 * базовые типы и интерфейсы корректно экспортируются
 * и могут использоваться в коде Router.
 *
 * Здесь нет реальной логики работы с БД или очередью —
 * цель файла дать пример использования интерфейсов
 * и служить точкой расширения для будущих реализаций.
 */

import {
  SessionEvent,
  SessionEventQueuePort,
  SessionEventStatus,
  SessionId,
  PlayerId,
  SessionStateRepositoryPort,
  SessionStateVersion,
} from '../src/sessionEvents';

function createDummyEvent(sessionId: SessionId, playerId: PlayerId): SessionEvent {
  const now = new Date();
  const status: SessionEventStatus = 'pending';

  return {
    id: 'event-1',
    sessionId,
    playerId,
    sequence: 1,
    actionId: 'test_action',
    payload: { value: 42 },
    status,
    attempts: 0,
    createdAt: now,
  };
}

class InMemoryQueue implements SessionEventQueuePort {
  private events: SessionEvent[] = [];

  async enqueue(eventInput: Omit<SessionEvent, 'id' | 'sequence' | 'status' | 'attempts' | 'createdAt'>): Promise<SessionEvent> {
    const sequence = this.events.length + 1;
    const createdAt = new Date();
    const event: SessionEvent = {
      id: `event-${sequence}`,
      sequence,
      status: 'pending',
      attempts: 0,
      createdAt,
      ...eventInput,
    };
    this.events.push(event);
    return event;
  }

  async acquireNextPending(sessionId: SessionId): Promise<SessionEvent | null> {
    const event = this.events.find((e) => e.sessionId === sessionId && e.status === 'pending');
    if (!event) {
      return null;
    }
    event.status = 'processing';
    return event;
  }

  async updateStatus(eventId: string, status: SessionEventStatus): Promise<void> {
    const event = this.events.find((e) => e.id === eventId);
    if (event) {
      event.status = status;
      event.processedAt = new Date();
    }
  }
}

class InMemorySessionStateRepository implements SessionStateRepositoryPort {
  private state = new Map<SessionId, { state: unknown; version: SessionStateVersion }>();

  async getState(sessionId: SessionId): Promise<{ state: unknown; version: SessionStateVersion }> {
    if (!this.state.has(sessionId)) {
      const version: SessionStateVersion = {
        sessionId,
        stateVersion: 0,
        lastEventSequence: 0,
      };
      this.state.set(sessionId, { state: {}, version });
    }
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return this.state.get(sessionId)!;
  }

  async applyEventDelta(params: {
    sessionId: SessionId;
    expectedVersion: SessionStateVersion;
    delta: unknown;
    event: SessionEvent;
  }): Promise<SessionStateVersion> {
    const current = await this.getState(params.sessionId);
    const nextVersion: SessionStateVersion = {
      sessionId: params.sessionId,
      stateVersion: current.version.stateVersion + 1,
      lastEventSequence: params.event.sequence,
    };
    this.state.set(params.sessionId, { state: params.delta, version: nextVersion });
    return nextVersion;
  }
}

// Простейший smoke-тест, который должен выполняться после настройки тестового раннера.
async function smokeTest() {
  const queue = new InMemoryQueue();
  const repository = new InMemorySessionStateRepository();

  const sessionId: SessionId = 'session-1';
  const playerId: PlayerId = 'player-1';

  const enqueued = await queue.enqueue({
    sessionId,
    playerId,
    actionId: 'test_action',
    payload: { value: 42 },
  });

  const next = await queue.acquireNextPending(sessionId);
  if (!next || next.id !== enqueued.id) {
    throw new Error('Очередь событий не вернула ожидаемое событие');
  }

  const currentState = await repository.getState(sessionId);
  const nextVersion = await repository.applyEventDelta({
    sessionId,
    expectedVersion: currentState.version,
    delta: { applied: true },
    event: next,
  });

  if (nextVersion.stateVersion !== 1 || nextVersion.lastEventSequence !== next.sequence) {
    throw new Error('Версия состояния не обновилась как ожидалось');
  }
}

// В реальном тестовом окружении этот вызов будет заменён на интеграцию с Jest/Mocha.
// Здесь вызов сохраняется как демонстрация того, что модуль может выполняться.
smokeTest().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('SessionEvents smoke test failed', error);
});

