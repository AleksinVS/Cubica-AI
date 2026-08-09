/** Public, server-only entry point for the isolated Stage 1 product-knowledge core. */
export * from './contracts.ts';
export * from './policy.ts';
export * from './conversation-postgres.ts';
export * from './model-gateway.ts';
export * from './shadow-cleanup.ts';
export * from './shadow-coordinator.ts';
export * from './shadow-database-url.ts';
export * from './shadow-grounding.ts';
export type * from './generated/product-knowledge.ts';
