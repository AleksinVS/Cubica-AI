/**
 * Entry point for shared Cubica SDK contracts and transports.
 * Replace placeholders with concrete implementations as the platform evolves.
 */

export * from './view-protocol';
export * from './state';

export interface SessionOptions {
  routerBaseUrl: string;
  transport?: "http" | "ws";
  retryCount?: number;
  authToken?: string;
  timeoutMs?: number;
}

export function validateSessionOptions(options: SessionOptions): void {
  if (!options.routerBaseUrl) {
    throw new Error('routerBaseUrl is required for session initialisation');
  }
  if (options.retryCount !== undefined && options.retryCount < 0) {
    throw new Error('retryCount cannot be negative');
  }
}

export function createSession(options: SessionOptions) {
  validateSessionOptions(options);
  return {
    options,
    async connect() {
      throw new Error('createSession.connect is a placeholder. Implement transport binding.');
    }
  };
}
