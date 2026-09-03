/**
 * Reads an HTTP response without buffering data beyond the caller's byte
 * ceiling. The optional abort callback lets the owner terminate the fetch as
 * soon as the stream proves that the response is too large.
 */
export class BoundedResponseLimitError extends Error {
  constructor() {
    super('HTTP response exceeded its byte limit.');
    this.name = 'BoundedResponseLimitError';
  }
}

export interface ReadBoundedResponseOptions {
  readonly abort?: () => void;
}

export async function readBoundedResponse(
  response: Response,
  limit: number,
  options: ReadBoundedResponseOptions = {}
): Promise<Uint8Array> {
  if (!Number.isSafeInteger(limit) || limit <= 0) throw new TypeError('A positive response byte limit is required.');

  const declared = response.headers.get('content-length');
  if (declared !== null && Number(declared) > limit) {
    options.abort?.();
    await cancelBody(response);
    throw new BoundedResponseLimitError();
  }

  if (!response.body) {
    // A fetch Response normally has a body stream. A missing stream has no
    // bytes to consume, so preserve the empty-payload behavior.
    return new Uint8Array(0);
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > limit) {
        options.abort?.();
        try { await reader.cancel(); } catch { /* Preserve the bounded error. */ }
        throw new BoundedResponseLimitError();
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function cancelBody(response: Response): Promise<void> {
  if (!response.body) return;
  try { await response.body.cancel(); } catch { /* Preserve the bounded error. */ }
}
