/** Hang the boot warm at this limit, then listen anyway. */
export const CALCULATOR_WARM_LIMIT_MS = 20_000;

/**
 * PM2 waits this long for process.send("ready"). It must exceed the warm limit
 * plus process boot (schema check, Redis, route setup).
 */
export const PM2_LISTEN_TIMEOUT_MS = 60_000;

/** In-process drain deadline. PM2 kill_timeout must be longer than this. */
export const PROCESS_DRAIN_MS = 8_000;

export const PM2_KILL_TIMEOUT_MS = 10_000;

export async function warmThenListen(args: {
  warm: () => Promise<void>;
  listen: () => void;
  limitMs?: number;
}): Promise<"warmed" | "timed-out" | "failed"> {
  const limitMs = args.limitMs ?? CALCULATOR_WARM_LIMIT_MS;
  let outcome: "warmed" | "timed-out" | "failed" = "timed-out";
  const warmPromise = args.warm().then(() => {
    outcome = "warmed";
  }).catch((err: unknown) => {
    outcome = "failed";
    const message = err instanceof Error ? err.message : String(err);
    console.error("Calculator cache warm failed:", message);
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, limitMs);
  });
  try {
    await Promise.race([warmPromise, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
  if (outcome === "timed-out") {
    console.error(`[boot] calculator warm exceeded ${limitMs}ms; signaling ready`);
  }
  args.listen();
  return outcome;
}
