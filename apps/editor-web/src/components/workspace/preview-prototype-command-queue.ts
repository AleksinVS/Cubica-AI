/** Commands to one player iframe finish in post order, including cancellation. */
export function createPreviewPrototypeCommandQueue() {
  let tail: Promise<void> = Promise.resolve();
  return {
    enqueue<T>(run: () => Promise<T>): Promise<T> {
      const pending = tail.then(run, run);
      tail = pending.then(() => undefined, () => undefined);
      return pending;
    }
  };
}
