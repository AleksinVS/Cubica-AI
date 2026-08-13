import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { ModelGatewayError } from '../src/model-gateway.ts';
import { ShadowAsyncWorker, classifyShadowWorkerError, type ShadowWorkerLease, type ShadowWorkerStore } from '../src/shadow-async-queue.ts';
import type { ModelGateway, ModelGatewayRequest, ShadowAuthorizationReceipt } from '../src/index.ts';

describe('durable asynchronous shadow worker', () => {
  it('keeps enqueue and worker SQL privileges separate and claims with SKIP LOCKED', async () => {
    const migration = await readFile(new URL('../migrations/003_product_context_async_shadow_queue.sql', import.meta.url), 'utf8');
    expect(migration).toContain('REVOKE UPDATE ON product_context_shadow.shadow_runs FROM product_context_shadow_app');
    expect(migration).toContain('TO product_context_shadow_worker_owner USING (true) WITH CHECK (true)');
    expect(migration).toContain('REVOKE ALL ON ALL TABLES IN SCHEMA product_context_shadow FROM product_context_shadow_worker');
    expect(migration).toContain('FOR UPDATE SKIP LOCKED');
    expect(migration).toContain('SECURITY DEFINER');
    expect(migration).not.toMatch(/authorization_header|provider_body|provider_messages/iu);
  });
  it('lets two workers race but only one lease and model call win', async () => {
    const store = new MemoryWorkerStore(lease());
    const gateway = gatewayThat(async (request) => ({ result:{schema_version:'1.0.0',request_id:request.request_id,outcome:'no_change',proposal:null},inputBytes:1,outputBytes:1,durationMs:1 }));
    const first = worker(store, gateway); const second = worker(store, gateway);
    const outcomes = await Promise.all([first.runOne(), second.runOne()]);
    expect(outcomes.sort()).toEqual(['completed', 'idle']);
    expect(gateway.call).toHaveBeenCalledOnce();
    expect(store.completed).toBe(1);
  });

  it('blocks before gateway creation when worker reauthorization is revoked', async () => {
    const store = new MemoryWorkerStore(lease());
    const gateway = gatewayThat(vi.fn());
    const current = { ...receipt(), authorization_revision:`sha256:${'b'.repeat(64)}` };
    const value = new ShadowAsyncWorker(store,{current:async()=>current},async()=>gateway,{leaseMs:20_000,authorizationTimeoutMs:100,retryBaseMs:1_000});
    await expect(value.runOne()).resolves.toBe('blocked');
    expect(gateway.call).not.toHaveBeenCalled();
    expect(store.terminalState).toMatchObject({ status:'denied', outcome:'authorization_changed' });
  });

  it('discards a successful provider payload when post-call authorization changes retention binding', async () => {
    const store = new MemoryWorkerStore(lease());
    const auth = receipt(); let calls = 0;
    const gateway = gatewayThat(async(request)=>({result:{schema_version:'1.0.0',request_id:request.request_id,outcome:'no_change',proposal:null},inputBytes:10,outputBytes:20,durationMs:3}));
    const authority = { current: async()=> ++calls === 1 ? auth : { ...auth, retention_policy_revision:'2' } };
    const value = new ShadowAsyncWorker(store,authority,async()=>gateway,{leaseMs:20_000,authorizationTimeoutMs:100,retryBaseMs:1_000,now:()=>new Date('2026-08-12T12:00:00Z')});
    await expect(value.runOne()).resolves.toBe('blocked');
    expect(gateway.call).toHaveBeenCalledOnce();
    expect(store.completed).toBe(0);
    expect(store.terminalState).toMatchObject({status:'denied',outcome:'authorization_changed'});
  });

  it.each([
    ['decision', (value:ShadowAuthorizationReceipt)=>({...value,decision:'deny'})],
    ['principal', (value:ShadowAuthorizationReceipt)=>({...value,shadow_principal_ref:'cubica://shadow-principal/v1/other'})],
    ['role', (value:ShadowAuthorizationReceipt)=>({...value,role_scope:'facilitator'})],
    ['applies_to', (value:ShadowAuthorizationReceipt)=>({...value,applies_to:['cubica://game-project/other']})],
    ['access policy', (value:ShadowAuthorizationReceipt)=>({...value,access_policy_revision:'2'})],
    ['retention policy', (value:ShadowAuthorizationReceipt)=>({...value,retention_policy_ref:'other-retention'})],
    ['external policy', (value:ShadowAuthorizationReceipt)=>({...value,external_processing_policy_revision:'2'})],
    ['authorization revision', (value:ShadowAuthorizationReceipt)=>({...value,authorization_revision:`sha256:${'b'.repeat(64)}`})]
  ])('discards a post-call result when the %s receipt binding drifts', async (_name, mutate) => {
    const store = new MemoryWorkerStore(lease()); const auth = receipt(); let calls = 0;
    const gateway = gatewayThat(async(request)=>({result:{schema_version:'1.0.0',request_id:request.request_id,outcome:'no_change',proposal:null},inputBytes:1,outputBytes:1,durationMs:1}));
    const value = new ShadowAsyncWorker(store,{current:async()=>++calls===1?auth:mutate(auth)},async()=>gateway,{leaseMs:20_000,authorizationTimeoutMs:100,retryBaseMs:1_000,now:()=>new Date('2026-08-12T12:00:00Z')});
    await expect(value.runOne()).resolves.toBe('blocked');
    expect(gateway.call).toHaveBeenCalledOnce(); expect(store.completed).toBe(0);
  });

  it('discards a successful provider payload when exact messages drift after the call', async () => {
    const store = new MemoryWorkerStore(lease());
    store.postCallTurn = { ...lease().turn, user_message:{...lease().turn.user_message, revision:`sha256:${'f'.repeat(64)}`} };
    const gateway = gatewayThat(async(request)=>({result:{schema_version:'1.0.0',request_id:request.request_id,outcome:'no_change',proposal:null},inputBytes:10,outputBytes:20,durationMs:3}));
    await expect(worker(store,gateway).runOne()).resolves.toBe('failed');
    expect(gateway.call).toHaveBeenCalledOnce();
    expect(store.completed).toBe(0);
    expect(store.terminalState).toMatchObject({status:'failed',outcome:'message_changed'});
  });

  it('blocks an unsafe lease that cannot cover model, post-call authorization, and terminal margin', async () => {
    const store = new MemoryWorkerStore(lease());
    const gateway = gatewayThat(vi.fn());
    Object.defineProperty(gateway,'timeoutMs',{value:15_000});
    const auth=receipt();
    const value=new ShadowAsyncWorker(store,{current:async()=>auth},async()=>gateway,{leaseMs:20_000,authorizationTimeoutMs:1_000,retryBaseMs:1_000,now:()=>new Date('2026-08-12T12:00:00Z')});
    await expect(value.runOne()).resolves.toBe('blocked');
    expect(gateway.call).not.toHaveBeenCalled();
    expect(store.terminalState).toMatchObject({code:'unsafe_timeout_configuration'});
  });

  it('retries only official transient codes with bounded exponential delay', async () => {
    const store = new MemoryWorkerStore(lease());
    const gateway = gatewayThat(async()=>{throw new ModelGatewayError('malformed_output','1303',503);});
    await expect(worker(store,gateway).runOne()).resolves.toBe('retry_wait');
    expect(store.retryState).toMatchObject({ code:'zai_1303' });
    expect(store.retryState!.next.getTime()).toBe(new Date('2026-08-12T12:00:00Z').getTime()+1_000);
  });

  it.each([
    ['1302','retry'],['1303','retry'],['1305','retry'],['1312','retry'],
    ['1000','blocked'],['1001','blocked'],['1002','blocked'],['1003','blocked'],['1004','blocked'],
    ['1113','blocked'],['1308','blocked'],['1309','blocked'],['1310','blocked'],['1311','blocked'],['1313','blocked']
  ])('maps Z.AI code %s to %s', (code,kind) => {
    expect(classifyShadowWorkerError(new ModelGatewayError('malformed_output',code,400)).kind).toBe(kind);
  });

  it('fails closed for unknown 429 and never retries uncertain timeout, transport, or 5xx', () => {
    expect(classifyShadowWorkerError(new ModelGatewayError('malformed_output',null,429))).toEqual({kind:'blocked',code:'zai_http_429_unknown'});
    expect(classifyShadowWorkerError(new ModelGatewayError('malformed_output',null,401))).toEqual({kind:'blocked',code:'zai_http_401'});
    for (const code of ['timeout','transport_error','outcome_unknown'] as const) {
      expect(classifyShadowWorkerError(new ModelGatewayError(code)).kind).toBe('failed');
    }
    expect(classifyShadowWorkerError(new ModelGatewayError('malformed_output',null,503)).kind).toBe('failed');
  });
});

class MemoryWorkerStore implements ShadowWorkerStore {
  private available = true;
  completed = 0;
  retryState: {code:string;next:Date}|null=null;
  terminalState: {status:string;outcome:string;code:string}|null=null;
  postCallTurn: ShadowWorkerLease['turn']|null=null;
  constructor(private readonly value:ShadowWorkerLease){}
  async leaseNext(){if(!this.available)return null;this.available=false;return this.value;}
  async reread(){return this.value.turn;}
  async prepareCall(){return this.value.turn;}
  async complete(){
    if (this.postCallTurn && this.postCallTurn.user_message.revision !== this.value.turn.user_message.revision) {
      this.terminalState={status:'failed',outcome:'message_changed',code:'message_changed'};
      return 'message_changed' as const;
    }
    this.completed+=1;return 'completed' as const;
  }
  async retry(_lease:ShadowWorkerLease,code:string,next:Date){this.retryState={code,next};}
  async terminal(_lease:ShadowWorkerLease,status:'denied'|'failed'|'blocked',outcome:string,code:string){this.terminalState={status,outcome,code};}
}
function worker(store:ShadowWorkerStore,gateway:ModelGateway){const auth=receipt();return new ShadowAsyncWorker(store,{current:async()=>auth},async()=>gateway,{leaseMs:20_000,authorizationTimeoutMs:100,retryBaseMs:1_000,now:()=>new Date('2026-08-12T12:00:00Z')});}
function gatewayThat(call:(request:ModelGatewayRequest)=>Promise<never>|Promise<{result:{schema_version:'1.0.0';request_id:string;outcome:'no_change';proposal:null};inputBytes:number;outputBytes:number;durationMs:number}>):ModelGateway&{call:ReturnType<typeof vi.fn>}{return{timeoutMs:10_000,maxRequestBytes:1024*1024,call:vi.fn(call)} as never;}
function receipt():ShadowAuthorizationReceipt{return{schema_version:'1.0.0',decision:'allow',shadow_principal_ref:'cubica://shadow-principal/v1/demo',role_scope:'developer',applies_to:['cubica://game-project/game_doc_1'],access_policy_ref:'access',access_policy_revision:'1',retention_policy_ref:'retention',retention_policy_revision:'1',external_processing_policy_ref:'external',external_processing_policy_revision:'1',authorization_revision:`sha256:${'a'.repeat(64)}`,issued_at:'2026-08-12T11:00:00Z',expires_at:'2026-08-12T13:00:00Z'};}
function lease():ShadowWorkerLease {const auth=receipt();const contentHash=`sha256:${createHash('sha256').update('').digest('hex')}` as `sha256:${string}`;const message=(actor:'user'|'agent',sequence:number)=>({schema_version:'1.0.0' as const,message_ref:`cubica://shadow-thread/v1/demo/message/${actor}`,thread_ref:'cubica://shadow-thread/v1/demo',stable_turn_key:'shadow-turn-v1:demo000000',sequence,actor,revision:`sha256:${createHash('sha256').update(`cubica-shadow-conversation-message/v1\n${actor}\n`).digest('hex')}` as `sha256:${string}`,content_hash:contentHash,content_base64:'',byte_length:0,tombstone:false,retained_until:'2026-08-12T13:00:00Z',created_at:'2026-08-12T12:00:00Z'});const user=message('user',1),agent=message('agent',2);return{token:'lease_demo',attempt:1,run:{runId:'shadowrun_demo',ownerRef:auth.shadow_principal_ref,threadRef:user.thread_ref,stableTurnKey:user.stable_turn_key,authorizationRevision:auth.authorization_revision,receipt:auth,userMessageRef:user.message_ref,userMessageRevision:user.revision,userMessageHash:user.content_hash,agentMessageRef:agent.message_ref,agentMessageRevision:agent.revision,agentMessageHash:agent.content_hash,status:'leased',outcome:null,requestId:null,result:null,leaseExpiresAt:'2026-08-12T12:01:00Z',retainedUntil:'2026-08-12T13:00:00Z'},turn:{schema_version:'1.0.0',turn_ref:'cubica://shadow-thread/v1/demo/turn/demo',thread_ref:user.thread_ref,stable_turn_key:user.stable_turn_key,user_message:user,agent_message:agent,created_at:user.created_at}};}
