/**
 * ObservationBuffer — micro-batch buffer for Skinport WS sale observations.
 *
 * Flushes when it reaches WS_BUFFER_MAX_ROWS rows OR WS_BUFFER_MAX_MS ms
 * after the first push in a batch. Flush failures are logged at most once
 * per minute and the batch is dropped (same observable behaviour as the
 * previous silent per-row catch). Exported so unit tests can exercise it
 * without importing socket.io-client.
 *
 * Tuning knobs:
 *   WS_BUFFER_MAX_ROWS  — flush when buffer reaches this many rows (default 50)
 *   WS_BUFFER_MAX_MS    — flush after this many ms since first push (default 500)
 */

export const WS_BUFFER_MAX_ROWS = 50;
export const WS_BUFFER_MAX_MS = 500;

export interface ObsRow {
  skinName: string;
  floatValue: number;
  priceCents: number;
}

type FlushFn = (rows: ObsRow[]) => Promise<void>;

export class ObservationBuffer {
  private rows: ObsRow[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastErrorAt = 0;
  private readonly maxRows: number;
  private readonly maxMs: number;
  private readonly flush: FlushFn;

  constructor(flush: FlushFn, maxRows = WS_BUFFER_MAX_ROWS, maxMs = WS_BUFFER_MAX_MS) {
    this.flush = flush;
    this.maxRows = maxRows;
    this.maxMs = maxMs;
  }

  push(row: ObsRow): void {
    this.rows.push(row);
    if (this.timer === null) {
      this.timer = setTimeout(() => this._flush(), this.maxMs);
    }
    if (this.rows.length >= this.maxRows) {
      this._flushSync();
    }
  }

  private _flushSync(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const batch = this.rows.splice(0);
    if (batch.length === 0) return;
    this.flush(batch).catch((err: unknown) => {
      const now = Date.now();
      if (now - this.lastErrorAt > 60_000) {
        console.error("[Skinport WS] observation flush error (batch dropped):", err);
        this.lastErrorAt = now;
      }
    });
  }

  private _flush(): void {
    this.timer = null;
    this._flushSync();
  }

  /** Force-flush any pending rows immediately (e.g. on shutdown). */
  async drain(): Promise<void> {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const batch = this.rows.splice(0);
    if (batch.length === 0) return;
    await this.flush(batch);
  }
}
