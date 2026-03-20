/**
 * Seeded PRNG for deterministic discovery/randomness tests.
 * Uses a simple xorshift128+ algorithm.
 */

export function createSeededRng(seed: number): () => number {
  let s0 = seed | 0 || 1;
  let s1 = (seed * 2654435769) | 0 || 1;

  return () => {
    let x = s0;
    const y = s1;
    s0 = y;
    x ^= x << 23;
    x ^= x >> 17;
    x ^= y;
    x ^= y >> 26;
    s1 = x;
    // Return value in [0, 1)
    return ((s0 + s1) >>> 0) / 4294967296;
  };
}

/**
 * Monkey-patch Math.random with a seeded RNG for the duration of a callback.
 * Restores original Math.random after.
 */
export async function withSeededRandom<T>(seed: number, fn: () => T | Promise<T>): Promise<T> {
  const original = Math.random;
  Math.random = createSeededRng(seed);
  try {
    return await fn();
  } finally {
    Math.random = original;
  }
}
