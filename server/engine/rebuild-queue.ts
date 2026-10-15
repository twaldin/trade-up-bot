let chain: Promise<void> = Promise.resolve();

/**
 * Price, float-ceiling, and KNN rebuilds share one queue so their CPU and
 * database reads never overlap. Callers that already have a cache do not wait.
 */
export function enqueueRebuild<T>(task: () => Promise<T>): Promise<T> {
  const run = chain.then(task, task);
  chain = run.then(() => undefined, () => undefined);
  return run;
}

export function resetRebuildQueueForTests(): void {
  chain = Promise.resolve();
}
