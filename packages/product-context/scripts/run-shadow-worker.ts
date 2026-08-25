/** One-shot durable shadow worker entry point for an external scheduler/job. */
import { createHmac } from 'node:crypto';
import { isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Pool } from 'pg';

import {
  PostgresShadowWorkerStore, ShadowAsyncWorker, ZAI_CODING_PLAN_ENDPOINT,
  ZAI_CODING_PLAN_MODEL, ZaiCodingPlanModelGateway, safeShadowDatabaseUrl,
  type ShadowAuthorizationReceipt, type ShadowWorkerTarget
} from '../src/index.ts';

export async function runShadowWorkerOnce(
  env: NodeJS.ProcessEnv = process.env,
  target: ShadowWorkerTarget | null = null
): Promise<'idle'|'completed'|'retry_wait'|'blocked'|'failed'> {
  const config = readShadowWorkerConfig(env);
  if (!config) throw new Error('Explicit bounded shadow worker configuration is required.');
  const pool = new Pool({ connectionString: config.databaseUrl, max: 2, connectionTimeoutMillis: 2_000, idleTimeoutMillis: 10_000, statement_timeout: config.databaseStatementTimeoutMs, lock_timeout: config.databaseLockTimeoutMs, allowExitOnIdle: true });
  try {
  await verifyWorkerLogin(pool);
  const worker = new ShadowAsyncWorker(
    new PostgresShadowWorkerStore(pool, target),
    { current: (receipt) => reauthorize(receipt, config) },
    async (receipt) => ZaiCodingPlanModelGateway.open({
      apiKey: config.apiKey, timeoutMs: config.modelTimeoutMs,
      maxRequestBytes: config.maxRequestBytes, maxResponseBytes: config.maxResponseBytes,
      requestBinding: {
        authorizationRevision: receipt.authorization_revision, shadowPrincipalRef: receipt.shadow_principal_ref,
        gameRef: receipt.applies_to[0]!, accessPolicyRef: receipt.access_policy_ref,
        accessPolicyRevision: receipt.access_policy_revision, retentionPolicyRef: receipt.retention_policy_ref,
        retentionPolicyRevision: receipt.retention_policy_revision,
        externalProcessingPolicyRef: receipt.external_processing_policy_ref,
        externalProcessingPolicyRevision: receipt.external_processing_policy_revision
      },
      grounding: {
        repository: config.knowledgeRepository, expectedPrincipalRef: receipt.shadow_principal_ref,
        expectedGameRef: receipt.applies_to[0]!, accessPolicyRef: receipt.access_policy_ref,
        accessPolicyRevision: receipt.access_policy_revision,
        externalProcessingPolicyRef: receipt.external_processing_policy_ref,
        externalProcessingPolicyRevision: receipt.external_processing_policy_revision
      }
    }),
    { leaseMs: config.leaseMs, authorizationTimeoutMs: config.authorizationTimeoutMs, retryBaseMs: config.retryBaseMs, maxAttempts: config.maxAttempts }
  );
  // The only emitted value is a content-free state; messages, bodies and
  // provider errors are intentionally never returned from this boundary.
    return await worker.runOne();
  } finally { await pool.end(); }
}

/** Runs only DB-clock terminal housekeeping and has no Portal or model capability. */
export async function runShadowWorkerRecoveryOnce(
  env: NodeJS.ProcessEnv,
  target: ShadowWorkerTarget
): Promise<'terminalized' | 'unsafe'> {
  const config = readShadowWorkerRecoveryConfig(env);
  if (!config) throw new Error('Explicit bounded shadow recovery configuration is required.');
  const pool = new Pool({ connectionString: config.databaseUrl, max: 1, connectionTimeoutMillis: 2_000, idleTimeoutMillis: 10_000, statement_timeout: config.databaseStatementTimeoutMs, lock_timeout: config.databaseLockTimeoutMs, allowExitOnIdle: true });
  try {
    await verifyWorkerLogin(pool);
    const safe = await new PostgresShadowWorkerStore(pool, target)
      .terminalizeExpiredTarget(config.leaseMs, 1);
    return safe ? 'terminalized' : 'unsafe';
  } finally { await pool.end(); }
}

export async function verifyWorkerLogin(pool: Pool): Promise<void> {
  const result = await pool.query<{ ready: boolean }>(`
    SELECT login.rolcanlogin AND NOT login.rolsuper AND NOT login.rolcreatedb AND
      NOT login.rolcreaterole AND NOT login.rolreplication AND NOT login.rolbypassrls AND
      NOT login.rolinherit AND
      (SELECT count(*) = 1 AND bool_and(granted.rolname = 'product_context_shadow_worker')
       FROM pg_auth_members AS membership
       JOIN pg_roles AS granted ON granted.oid = membership.roleid
       WHERE membership.member = login.oid) AS ready
    FROM pg_roles AS login WHERE login.rolname = session_user AND current_user = session_user
  `);
  if (result.rows[0]?.ready !== true) throw new Error('Dedicated shadow worker login is required.');
}

export interface ShadowWorkerConfig { databaseUrl:string; portalUrl:string; reauthorizationKey:string; apiKey:string; knowledgeRepository:string; modelTimeoutMs:number; authorizationTimeoutMs:number; leaseMs:number; retryBaseMs:number; maxAttempts:number; maxRequestBytes:number; maxResponseBytes:number; databaseStatementTimeoutMs:number; databaseLockTimeoutMs:number; }
export interface ShadowWorkerRecoveryConfig { databaseUrl:string; leaseMs:number; maxAttempts:1; databaseStatementTimeoutMs:number; databaseLockTimeoutMs:number; }
const MAX_MODEL_TIMEOUT_MS = 90_000;
export function readShadowWorkerRecoveryConfig(env:NodeJS.ProcessEnv):ShadowWorkerRecoveryConfig|null {
  const databaseUrl=safeShadowDatabaseUrl(env.CUBICA_PRODUCT_CONTEXT_SHADOW_WORKER_DATABASE_URL);
  const leaseMs=integer(env.CUBICA_PRODUCT_CONTEXT_SHADOW_WORKER_LEASE_MS,5_001,120_000);
  const maxAttempts=integer(env.CUBICA_PRODUCT_CONTEXT_SHADOW_MAX_ATTEMPTS,1,1);
  const databaseStatementTimeoutMs=integer(env.CUBICA_PRODUCT_CONTEXT_SHADOW_WORKER_DATABASE_STATEMENT_TIMEOUT_MS,100,30_000);
  const databaseLockTimeoutMs=integer(env.CUBICA_PRODUCT_CONTEXT_SHADOW_WORKER_DATABASE_LOCK_TIMEOUT_MS,100,10_000);
  if(!['test','staging'].includes(env.CUBICA_DEPLOYMENT_TIER??'')||!databaseUrl||leaseMs===null||maxAttempts!==1||databaseStatementTimeoutMs===null||databaseLockTimeoutMs===null||databaseLockTimeoutMs>databaseStatementTimeoutMs)return null;
  return {databaseUrl,leaseMs,maxAttempts:1,databaseStatementTimeoutMs,databaseLockTimeoutMs};
}
export function readShadowWorkerConfig(env:NodeJS.ProcessEnv):ShadowWorkerConfig|null {
  const databaseUrl=safeShadowDatabaseUrl(env.CUBICA_PRODUCT_CONTEXT_SHADOW_WORKER_DATABASE_URL);
  const portalBase=safeUrl(env.CUBICA_PORTAL_API_URL); const key=env.CUBICA_PRODUCT_CONTEXT_SHADOW_REAUTHORIZATION_KEY??'';
  const apiKey=env.PKS_KEY??''; const repository=env.CUBICA_PRODUCT_CONTEXT_SHADOW_KNOWLEDGE_REPOSITORY??'';
  const modelTimeoutMs=integer(env.CUBICA_PRODUCT_CONTEXT_SHADOW_MODEL_TIMEOUT_MS,1,MAX_MODEL_TIMEOUT_MS);
  const authorizationTimeoutMs=integer(env.CUBICA_PRODUCT_CONTEXT_SHADOW_AUTHORIZATION_TIMEOUT_MS,1,15_000);
  const leaseMs=integer(env.CUBICA_PRODUCT_CONTEXT_SHADOW_WORKER_LEASE_MS,5_001,120_000);
  const retryBaseMs=integer(env.CUBICA_PRODUCT_CONTEXT_SHADOW_RETRY_BASE_MS,1_000,300_000);
  const maxAttempts=integer(env.CUBICA_PRODUCT_CONTEXT_SHADOW_MAX_ATTEMPTS,1,8);
  const maxRequestBytes=integer(env.CUBICA_PRODUCT_CONTEXT_SHADOW_MODEL_MAX_REQUEST_BYTES,1,1024*1024);
  const maxResponseBytes=integer(env.CUBICA_PRODUCT_CONTEXT_SHADOW_MODEL_MAX_RESPONSE_BYTES,1,1024*1024);
  const databaseStatementTimeoutMs=integer(env.CUBICA_PRODUCT_CONTEXT_SHADOW_WORKER_DATABASE_STATEMENT_TIMEOUT_MS,100,30_000);
  const databaseLockTimeoutMs=integer(env.CUBICA_PRODUCT_CONTEXT_SHADOW_WORKER_DATABASE_LOCK_TIMEOUT_MS,100,10_000);
  let endpoint=false; try { endpoint=new URL('chat/completions',env.PKS_BASE_URL).toString()===ZAI_CODING_PLAN_ENDPOINT; } catch {}
  if(env.CUBICA_PRODUCT_CONTEXT_SHADOW_ZAI_CODING_PLAN_ENABLED!=='true'||!['test','staging'].includes(env.CUBICA_DEPLOYMENT_TIER??'')||!databaseUrl||!portalBase||Buffer.byteLength(key)<32||!apiKey||!isAbsolute(repository)||!endpoint||env.PKS_MODEL!==ZAI_CODING_PLAN_MODEL||
    modelTimeoutMs===null||authorizationTimeoutMs===null||leaseMs===null||retryBaseMs===null||maxAttempts===null||maxRequestBytes===null||maxResponseBytes===null||databaseStatementTimeoutMs===null||databaseLockTimeoutMs===null||databaseLockTimeoutMs>databaseStatementTimeoutMs||leaseMs<modelTimeoutMs+authorizationTimeoutMs+5_000)return null;
  return {databaseUrl,portalUrl:new URL('/api/product-context/shadow-worker-reauthorization',portalBase).toString(),reauthorizationKey:key,apiKey,knowledgeRepository:repository,modelTimeoutMs,authorizationTimeoutMs,leaseMs,retryBaseMs,maxAttempts,maxRequestBytes,maxResponseBytes,databaseStatementTimeoutMs,databaseLockTimeoutMs};
}
async function reauthorize(receipt:ShadowAuthorizationReceipt,config:ShadowWorkerConfig):Promise<unknown>{
  const issuedAt=new Date().toISOString(); const gameDocumentId=receipt.applies_to[0]!.slice('cubica://game-project/'.length);
  const body={shadowPrincipalRef:receipt.shadow_principal_ref,gameDocumentId,authorizationRevision:receipt.authorization_revision,issuedAt};
  const payload=['cubica-product-context-shadow-worker-reauthorization/v1',body.shadowPrincipalRef,body.gameDocumentId,body.authorizationRevision,body.issuedAt].join('\0');
  const signature=createHmac('sha256',config.reauthorizationKey).update(payload).digest('hex');
  const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),config.authorizationTimeoutMs);timer.unref?.();
  try {
    const response=await fetch(config.portalUrl,{method:'POST',redirect:'error',headers:{'content-type':'application/json','x-cubica-shadow-worker-signature':signature},body:JSON.stringify(body),signal:controller.signal,cache:'no-store'});
    if(!response.ok||Number(response.headers.get('content-length')??0)>64*1024)return null;
    const bytes=new Uint8Array(await response.arrayBuffer()); if(bytes.byteLength>64*1024)return null;
    try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{return null;}
  }
  finally {clearTimeout(timer);}
}
function integer(value:string|undefined,min:number,max:number):number|null{if(!value||!/^\d+$/u.test(value))return null;const n=Number(value);return Number.isSafeInteger(n)&&n>=min&&n<=max?n:null;}
function safeUrl(value:string|undefined):string|null{try{const url=new URL(value??'');const loopback=['127.0.0.1','localhost','::1'].includes(url.hostname);return url.protocol==='https:'||(url.protocol==='http:'&&loopback)?url.toString():null;}catch{return null;}}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runShadowWorkerOnce().then((result) => process.stdout.write(`${result}\n`)).catch(() => {
    process.stderr.write('Shadow worker refused or failed.\n');
    process.exitCode = 1;
  });
}
