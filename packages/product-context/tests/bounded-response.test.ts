import { describe, expect, it, vi } from 'vitest';

import { BoundedResponseLimitError, readBoundedResponse } from '../src/bounded-response.ts';

const limit = 64 * 1024;

describe('bounded HTTP response reader', () => {
  it('stops after a chunked response crosses the limit and cancels the stream', async () => {
    let pulls = 0;
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        controller.enqueue(pulls === 1 ? new Uint8Array(limit) : new Uint8Array(1));
        if (pulls > 2) controller.close();
      },
      cancel
    });
    const response = new Response(stream);
    const arrayBuffer = vi.spyOn(response, 'arrayBuffer');
    const abort = vi.fn();

    await expect(readBoundedResponse(response, limit, { abort })).rejects.toBeInstanceOf(BoundedResponseLimitError);
    expect(abort).toHaveBeenCalledOnce();
    expect(cancel).toHaveBeenCalledOnce();
    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(pulls).toBe(2);
  });

  it('accepts a response whose consumed bytes are exactly the limit', async () => {
    const bytes = await readBoundedResponse(new Response(new Uint8Array(limit)), limit);

    expect(bytes.byteLength).toBe(limit);
  });

  it('leaves malformed JSON to the caller while still bounding its bytes', async () => {
    const bytes = await readBoundedResponse(new Response('{malformed'), limit);

    expect(() => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))).toThrow(SyntaxError);
  });

  it('cancels a response rejected by its declared length before consuming it', async () => {
    const cancel = vi.fn();
    const response = new Response(new ReadableStream<Uint8Array>({ cancel }), {
      headers: { 'content-length': String(limit + 1) }
    });
    const abort = vi.fn();

    await expect(readBoundedResponse(response, limit, { abort })).rejects.toBeInstanceOf(BoundedResponseLimitError);
    expect(abort).toHaveBeenCalledOnce();
    expect(cancel).toHaveBeenCalledOnce();
  });
});
