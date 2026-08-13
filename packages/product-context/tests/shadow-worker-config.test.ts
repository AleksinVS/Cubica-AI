import { describe, expect, it, vi } from 'vitest';

import { readShadowWorkerConfig } from '../scripts/run-shadow-worker.ts';

describe('shadow worker import-safe configuration', () => {
  it('accepts only explicit test/staging fixed Z.AI and bounded worker settings', () => {
    const env = configured();
    expect(readShadowWorkerConfig(env)).toMatchObject({
      modelTimeoutMs:10_000,authorizationTimeoutMs:2_000,leaseMs:17_000,
      maxAttempts:3,portalUrl:'http://localhost:1337/api/product-context/shadow-worker-reauthorization'
    });
    for (const variant of [
      {...env,CUBICA_DEPLOYMENT_TIER:'production'},
      {...env,CUBICA_PRODUCT_CONTEXT_SHADOW_ZAI_CODING_PLAN_ENABLED:'false'},
      {...env,PKS_MODEL:'other'},
      {...env,PKS_BASE_URL:'https://api.z.ai/api/coding/paas/v4/other/'},
      {...env,CUBICA_PRODUCT_CONTEXT_SHADOW_WORKER_DATABASE_URL:'postgresql://db.internal/shadow'},
      {...env,CUBICA_PRODUCT_CONTEXT_SHADOW_WORKER_LEASE_MS:'16999'},
      {...env,CUBICA_PRODUCT_CONTEXT_SHADOW_AUTHORIZATION_TIMEOUT_MS:undefined},
      {...env,CUBICA_PRODUCT_CONTEXT_SHADOW_RETRY_BASE_MS:undefined}
    ]) expect(readShadowWorkerConfig(variant)).toBeNull();
  });

  it('does not open a database, Portal, or provider merely by importing config helpers', () => {
    const fetchSpy=vi.spyOn(globalThis,'fetch');
    expect(readShadowWorkerConfig(configured())).not.toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

function configured():NodeJS.ProcessEnv{return{
  NODE_ENV:'test',CUBICA_DEPLOYMENT_TIER:'test',CUBICA_PRODUCT_CONTEXT_SHADOW_ZAI_CODING_PLAN_ENABLED:'true',
  CUBICA_PRODUCT_CONTEXT_SHADOW_WORKER_DATABASE_URL:'postgres://localhost/shadow',CUBICA_PORTAL_API_URL:'http://localhost:1337',
  CUBICA_PRODUCT_CONTEXT_SHADOW_REAUTHORIZATION_KEY:'w'.repeat(32),CUBICA_PRODUCT_CONTEXT_SHADOW_KNOWLEDGE_REPOSITORY:'/srv/cubica/knowledge',
  PKS_KEY:'test-key',PKS_BASE_URL:'https://api.z.ai/api/coding/paas/v4/',PKS_MODEL:'glm-4.7',
  CUBICA_PRODUCT_CONTEXT_SHADOW_MODEL_TIMEOUT_MS:'10000',CUBICA_PRODUCT_CONTEXT_SHADOW_AUTHORIZATION_TIMEOUT_MS:'2000',
  CUBICA_PRODUCT_CONTEXT_SHADOW_WORKER_LEASE_MS:'17000',CUBICA_PRODUCT_CONTEXT_SHADOW_RETRY_BASE_MS:'1000',
  CUBICA_PRODUCT_CONTEXT_SHADOW_MAX_ATTEMPTS:'3',CUBICA_PRODUCT_CONTEXT_SHADOW_MODEL_MAX_REQUEST_BYTES:'524288',
  CUBICA_PRODUCT_CONTEXT_SHADOW_MODEL_MAX_RESPONSE_BYTES:'524288',CUBICA_PRODUCT_CONTEXT_SHADOW_WORKER_DATABASE_STATEMENT_TIMEOUT_MS:'5000',
  CUBICA_PRODUCT_CONTEXT_SHADOW_WORKER_DATABASE_LOCK_TIMEOUT_MS:'1000'
};}
