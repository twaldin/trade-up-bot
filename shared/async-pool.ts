/** Run async work with a hard concurrency cap. */
export async function mapPool<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Math.max(1, Math.min(limit, items.length));
  async function run(): Promise<void> {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index]);
    }
  }
  await Promise.all(Array.from({ length: workers }, () => run()));
  return results;
}

export const OUTCOME_HYDRATE_CONCURRENCY = 2;
