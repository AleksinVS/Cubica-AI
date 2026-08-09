import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import type { AppendExactTurnInput, ClaimRunResult, ShadowCleanupResult, ShadowConversationStore, ShadowRunRecord, ShadowRunOutcome } from '../src/conversation-postgres.ts';
import type { ModelGateway, ModelGatewayCall } from '../src/model-gateway.ts';
import { ShadowCoordinator } from '../src/shadow-coordinator.ts';
import type { ConversationMessage, ConversationTurn, ModelGatewayResult, ShadowAuthorizationReceipt, ShadowContentFreeMetric } from '../src/generated/product-knowledge.ts';

const now = new Date('2026-08-09T12:00:00Z');
const authorization = `sha256:${'a'.repeat(64)}` as const;
const receipt: ShadowAuthorizationReceipt = {
  schema_version: '1.0.0', decision: 'allow', shadow_principal_ref: 'cubica://shadow-principal/demo',
  role_scope: 'developer', applies_to: ['cubica://game-project/demo'], access_policy_ref: 'access',
  access_policy_revision: '1', retention_policy_ref: 'retention', retention_policy_revision: '1',
  external_processing_policy_ref: 'external', external_processing_policy_revision: '1',
  authorization_revision: authorization, issued_at: '2026-08-09T11:00:00Z', expires_at: '2026-08-09T13:00:00Z'
};

describe('shadow coordinator security binding', () => {
  it.each(['actor', 'bytes', 'deleted'] as const)('blocks %s drift before the gateway', async (drift) => {
    const store = new MemoryStore(drift);
    const gateway = new FakeGateway();
    const coordinator = coordinatorFor(store, gateway);
    const result = await coordinator.run(input());
    expect(result).toMatchObject({ status: 'failed', outcome: drift === 'deleted' ? 'message_deleted' : 'message_changed' });
    expect(gateway.calls).toBe(0);
  });

  it('blocks changed authorization revision before the gateway', async () => {
    const store = new MemoryStore(); const gateway = new FakeGateway();
    const coordinator = new ShadowCoordinator(store, { current: async () => ({ ...receipt, authorization_revision: `sha256:${'b'.repeat(64)}` }) }, gateway, options());
    await expect(coordinator.run(input())).resolves.toMatchObject({ status: 'denied', outcome: 'authorization_changed' });
    expect(gateway.calls).toBe(0);
    expect(store.turn).toBeNull();
  });

  it('uses only a freshly reauthorized receipt for append and run storage', async () => {
    const events: string[] = [];
    const fresh = { ...receipt, issued_at: '2026-08-09T11:59:00Z', expires_at: '2026-08-09T12:30:00Z' };
    class OrderedStore extends MemoryStore {
      storedReceipt: ShadowAuthorizationReceipt | null = null;
      override async appendExactTurn(value: AppendExactTurnInput) { events.push('append'); return super.appendExactTurn(value); }
      override async createRun(auth: ShadowAuthorizationReceipt, turn: ConversationTurn, retainedUntil: Date) { this.storedReceipt = auth; return super.createRun(auth, turn, retainedUntil); }
    }
    const store = new OrderedStore(); const gateway = new FakeGateway();
    const coordinator = new ShadowCoordinator(store, { current: async () => { events.push('authorize'); return fresh; } }, gateway, options());
    await expect(coordinator.run(input())).resolves.toMatchObject({ status: 'completed' });
    expect(events.slice(0, 2)).toEqual(['authorize', 'append']);
    expect(store.storedReceipt?.issued_at).toBe(fresh.issued_at);
  });

  it('blocks revoked authority after claim and exact reread but before the gateway', async () => {
    const store = new MemoryStore(); const gateway = new FakeGateway(); let checks = 0;
    const coordinator = new ShadowCoordinator(store, {
      current: async () => ++checks === 1 ? receipt : { ...receipt, authorization_revision: `sha256:${'b'.repeat(64)}` }
    }, gateway, options());
    await expect(coordinator.run(input())).resolves.toMatchObject({ status: 'denied', outcome: 'authorization_changed' });
    expect(store.turn).not.toBeNull();
    expect(store.run).toMatchObject({ status: 'denied', result: null });
    expect(gateway.calls).toBe(0);
  });

  it('drops the provider payload when authority changes after the call', async () => {
    const store = new MemoryStore(); const gateway = new FakeGateway(); let checks = 0;
    const coordinator = new ShadowCoordinator(store, { current: async () => ++checks <= 2 ? receipt : { ...receipt, authorization_revision: `sha256:${'b'.repeat(64)}` } }, gateway, options());
    await expect(coordinator.run(input())).resolves.toMatchObject({ status: 'denied', outcome: 'authorization_changed' });
    expect(gateway.calls).toBe(1);
    expect(store.run).toMatchObject({ status: 'denied', result: null });
    expect(store.metrics).toHaveLength(1);
  });

  it('drops the provider payload when exact messages drift after the call', async () => {
    class PostCallDriftStore extends MemoryStore {
      reads = 0;
      override async rereadExactTurn() {
        const turn = await super.rereadExactTurn();
        if (++this.reads === 2 && turn) return { ...turn, user_message: { ...turn.user_message, content_base64: Buffer.from('changed').toString('base64') } };
        return turn;
      }
    }
    const store = new PostCallDriftStore(); const gateway = new FakeGateway();
    await expect(coordinatorFor(store, gateway).run(input())).resolves.toMatchObject({ status: 'failed', outcome: 'message_changed' });
    expect(store.run).toMatchObject({ status: 'failed', result: null });
  });

  it('rejects the aggregate base64 request budget before storing exact bytes', async () => {
    const store = new MemoryStore(); const gateway = new FakeGateway(1);
    await expect(coordinatorFor(store, gateway).run(input())).resolves.toMatchObject({ status: 'failed', runId: null, outcome: 'gateway_oversize' });
    expect(store.turn).toBeNull();
    expect(gateway.calls).toBe(0);
  });

  it('runs once for a stable turn key and records only content-free metrics', async () => {
    const store = new MemoryStore(); const gateway = new FakeGateway(); const coordinator = coordinatorFor(store, gateway);
    const first = await coordinator.run(input());
    const repeated = await coordinator.run(input());
    expect(first).toMatchObject({ status: 'completed', duplicate: false });
    expect(repeated).toMatchObject({ status: 'completed', duplicate: true });
    expect(gateway.calls).toBe(1);
    const serialized = JSON.stringify(store.metrics);
    expect(serialized).not.toContain('exact user secret');
    expect(serialized).not.toContain('exact agent secret');
    expect(store.metrics[0]).toMatchObject({ outcome: 'no_change', input_bytes: 42, output_bytes: 17, proposal_operation_count: 0 });
  });
});

function input() {
  return {
    authorizationReceipt: receipt, threadRef: 'cubica://shadow-thread/demo', stableTurnKey: 'stable-turn-key-0001',
    userBytes: new TextEncoder().encode('exact user secret'), agentBytes: new TextEncoder().encode('exact agent secret')
  };
}
function options() { return { enabled: true, environment: 'test', retentionMs: 60_000, now: () => new Date(now) }; }
function coordinatorFor(store: MemoryStore, gateway: FakeGateway) {
  return new ShadowCoordinator(store, { current: async () => ({ ...receipt }) }, gateway, options());
}

class FakeGateway implements ModelGateway {
  calls = 0;
  constructor(readonly maxRequestBytes = 512 * 1024) {}
  async call(request: Parameters<ModelGateway['call']>[0]): Promise<ModelGatewayCall> {
    this.calls += 1;
    return { result: { schema_version: '1.0.0', request_id: request.request_id, outcome: 'no_change', proposal: null }, inputBytes: 42, outputBytes: 17, durationMs: 3 };
  }
}

class MemoryStore implements ShadowConversationStore {
  turn: ConversationTurn | null = null;
  run: ShadowRunRecord | null = null;
  metrics: ShadowContentFreeMetric[] = [];
  constructor(private readonly drift: 'actor' | 'bytes' | 'deleted' | null = null) {}
  async appendExactTurn(value: AppendExactTurnInput): Promise<ConversationTurn> {
    if (this.turn) {
      if (this.turn.user_message.content_base64 !== Buffer.from(value.userBytes).toString('base64') || this.turn.agent_message.content_base64 !== Buffer.from(value.agentBytes).toString('base64')) throw new Error('idempotency conflict');
      return this.turn;
    }
    const user = message(value, 'user', value.userBytes, 1); const agent = message(value, 'agent', value.agentBytes, 2);
    this.turn = { schema_version: '1.0.0', turn_ref: `${value.threadRef}/turn/one`, thread_ref: value.threadRef, stable_turn_key: value.stableTurnKey, user_message: user, agent_message: agent, created_at: now.toISOString() };
    return this.turn;
  }
  async rereadExactTurn(): Promise<ConversationTurn | null> {
    if (!this.turn) return null;
    if (this.drift === 'actor') return { ...this.turn, user_message: { ...this.turn.user_message, actor: 'agent' } };
    if (this.drift === 'bytes') return { ...this.turn, user_message: { ...this.turn.user_message, content_base64: Buffer.from('changed').toString('base64') } };
    if (this.drift === 'deleted') return { ...this.turn, user_message: { ...this.turn.user_message, tombstone: true, content_base64: null, deleted_at: now.toISOString() } };
    return structuredClone(this.turn);
  }
  async createRun(auth: ShadowAuthorizationReceipt, turn: ConversationTurn, retainedUntil: Date): Promise<ShadowRunRecord> {
    if (this.run) return this.run;
    this.run = { runId: 'shadowrun_demo', ownerRef: auth.shadow_principal_ref, threadRef: turn.thread_ref, stableTurnKey: turn.stable_turn_key, authorizationRevision: auth.authorization_revision, receipt: auth, userMessageRef: turn.user_message.message_ref, userMessageRevision: turn.user_message.revision, userMessageHash: turn.user_message.content_hash, agentMessageRef: turn.agent_message.message_ref, agentMessageRevision: turn.agent_message.revision, agentMessageHash: turn.agent_message.content_hash, status: 'pending', outcome: null, requestId: null, result: null, leaseExpiresAt: null, retainedUntil: retainedUntil.toISOString() };
    return this.run!;
  }
  async claimRun(_owner: string, _run: string, requestId: string, leaseMs: number): Promise<ClaimRunResult> {
    if (!this.run || this.run.status !== 'pending') return { kind: 'in_progress', run: this.run! };
    this.run = { ...this.run, status: 'calling_model', requestId, leaseExpiresAt: new Date(now.getTime() + leaseMs).toISOString() };
    return { kind: 'claimed', run: this.run };
  }
  async completeRun(_owner: string, _run: string, result: ModelGatewayResult, outcome: 'success' | 'no_change', value: ShadowContentFreeMetric): Promise<ShadowRunRecord> { this.run = { ...this.run!, status: 'succeeded', result, outcome, leaseExpiresAt: null }; this.metrics.push(value); return this.run; }
  async failRun(_owner: string, _run: string, outcome: Exclude<ShadowRunOutcome, 'success' | 'no_change' | 'disabled'>, value: ShadowContentFreeMetric): Promise<ShadowRunRecord> { this.run = { ...this.run!, status: outcome === 'authorization_changed' ? 'denied' : 'failed', outcome, leaseExpiresAt: null }; this.metrics.push(value); return this.run; }
  async cleanupExpired(): Promise<ShadowCleanupResult> { return { runsDeleted: 0, messagesTombstoned: 0, threadsTombstoned: 0 }; }
}

function message(input: AppendExactTurnInput, actor: 'user' | 'agent', bytes: Uint8Array, sequence: number): ConversationMessage {
  const digest = `sha256:${createHash('sha256').update(bytes).digest('hex')}` as const;
  const revision = `sha256:${createHash('sha256').update(`cubica-shadow-conversation-message/v1\n${actor}\n`, 'utf8').update(bytes).digest('hex')}` as const;
  const refDigest = createHash('sha256').update(`${input.ownerRef}\n${input.stableTurnKey}\n${actor}`, 'utf8').digest('hex').slice(0, 32);
  return { schema_version: '1.0.0', message_ref: `${input.threadRef}/message/${refDigest}`, thread_ref: input.threadRef, stable_turn_key: input.stableTurnKey, sequence, actor, revision, content_hash: digest, byte_length: bytes.byteLength, content_base64: Buffer.from(bytes).toString('base64'), tombstone: false, retained_until: input.retainedUntil.toISOString(), created_at: now.toISOString() };
}
