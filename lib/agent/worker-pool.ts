export interface WorkerPoolOptions<T, R> {
  tasks: T[];
  concurrency?: number;
  signal?: AbortSignal;
  process: (task: T) => Promise<R>;
  onResult?: (result: R, index: number) => void;
  onError?: (error: unknown, task: T, index: number) => void;
}

export async function runWorkerPool<T, R>(opts: WorkerPoolOptions<T, R>): Promise<R[]> {
  const {
    tasks,
    concurrency = 8,
    signal,
    process: processTask,
    onResult,
    onError,
  } = opts;

  const results: R[] = new Array(tasks.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < tasks.length) {
      if (signal?.aborted) break;
      const idx = nextIndex++;
      const task = tasks[idx];
      try {
        const result = await processTask(task);
        results[idx] = result;
        onResult?.(result, idx);
      } catch (err) {
        onError?.(err, task, idx);
      }
    }
  }

  const n = Math.min(concurrency, tasks.length);
  if (n > 0) {
    await Promise.all(Array.from({ length: n }, () => worker()));
  }
  return results;
}
