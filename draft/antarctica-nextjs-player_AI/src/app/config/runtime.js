export const routerConfig = {
  baseUrl: process.env.NEXT_PUBLIC_ROUTER_BASE_URL || '/api',
  authToken: process.env.NEXT_PUBLIC_ROUTER_TOKEN || '',
  timeoutMs: Number(process.env.NEXT_PUBLIC_ROUTER_TIMEOUT_MS || 10000),
};
