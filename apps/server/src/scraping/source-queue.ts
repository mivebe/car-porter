export interface QueueOptions {
  delay: () => { minMs: number; maxMs: number };
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Serializes work per source and enforces a randomized pause between consecutive tasks of the
 * same source (measured from the end of the previous task). Different sources run in parallel.
 */
export function createSourceQueue({
  delay,
  now = Date.now,
  sleep = defaultSleep,
  random = Math.random,
}: QueueOptions) {
  const tails = new Map<string, Promise<unknown>>();
  const lastFinished = new Map<string, number>();

  function run<T>(source: string, task: () => Promise<T>): Promise<T> {
    const previous = tails.get(source) ?? Promise.resolve();

    const next = previous
      .catch(() => undefined)
      .then(async () => {
        const finishedAt = lastFinished.get(source);
        if (finishedAt !== undefined) {
          const { minMs, maxMs } = delay();
          const wanted = minMs + random() * Math.max(0, maxMs - minMs);
          const remaining = wanted - (now() - finishedAt);
          if (remaining > 0) await sleep(remaining);
        }
        try {
          return await task();
        } finally {
          lastFinished.set(source, now());
        }
      });

    tails.set(source, next);
    return next;
  }

  return { run };
}

export type SourceQueue = ReturnType<typeof createSourceQueue>;
