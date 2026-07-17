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
  SessionCommandQueueItem,
  SessionCommandQueuePort,
  SessionCommandQueueStatus,
  SessionId,
  SessionPrincipalId,
  SessionStateRepositoryPort,
  SessionStateVersion,
} from '../src/sessionEvents';

function createDummyCommand(sessionId: SessionId, principalId: SessionPrincipalId): SessionCommandQueueItem {
  const now = new Date();
  const status: SessionCommandQueueStatus = 'pending';

  return {
    id: 'command-item-1',
    sessionId,
    principalId,
    sequence: 1,
    commandId: 'cli_0000000000000000000001',
    actionId: 'test_action',
    expectedStateVersion: 0,
    params: { value: 42 },
    status,
    attempts: 0,
    createdAt: now,
  };
}

class InMemoryQueue implements SessionCommandQueuePort {
  private commands: SessionCommandQueueItem[] = [];

  async enqueue(commandInput: Omit<SessionCommandQueueItem, 'id' | 'sequence' | 'status' | 'attempts' | 'createdAt'>): Promise<SessionCommandQueueItem> {
    const sequence = this.commands.length + 1;
    const createdAt = new Date();
    const command: SessionCommandQueueItem = {
      id: `command-item-${sequence}`,
      sequence,
      status: 'pending',
      attempts: 0,
      createdAt,
      ...commandInput,
    };
    this.commands.push(command);
    return command;
  }

  async acquireNextPending(sessionId: SessionId): Promise<SessionCommandQueueItem | null> {
    const command = this.commands.find((item) => item.sessionId === sessionId && item.status === 'pending');
    if (!command) {
      return null;
    }
    command.status = 'processing';
    return command;
  }

  async updateStatus(itemId: string, status: SessionCommandQueueStatus): Promise<void> {
    const command = this.commands.find((item) => item.id === itemId);
    if (command) {
      command.status = status;
      command.processedAt = new Date();
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

  async applyCommandDelta(params: {
    sessionId: SessionId;
    expectedVersion: SessionStateVersion;
    delta: unknown;
    command: SessionCommandQueueItem;
  }): Promise<SessionStateVersion> {
    const current = await this.getState(params.sessionId);
    const nextVersion: SessionStateVersion = {
      sessionId: params.sessionId,
      stateVersion: current.version.stateVersion + 1,
      lastEventSequence: params.command.sequence,
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
  const principalId: SessionPrincipalId = 'principal-1';

  const enqueued = await queue.enqueue({
    sessionId,
    principalId,
    commandId: 'cli_0000000000000000000001',
    actionId: 'test_action',
    expectedStateVersion: 0,
    params: { value: 42 },
  });

  const next = await queue.acquireNextPending(sessionId);
  if (!next || next.id !== enqueued.id) {
    throw new Error('Очередь событий не вернула ожидаемое событие');
  }

  const currentState = await repository.getState(sessionId);
  const nextVersion = await repository.applyCommandDelta({
    sessionId,
    expectedVersion: currentState.version,
    delta: { applied: true },
    command: next,
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
