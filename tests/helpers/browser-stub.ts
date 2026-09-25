// Minimal browser globals for client analytics tests (vitest runs in node, no jsdom).
import { vi } from "vitest";

export interface MemoryStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  clear(): void;
  readonly data: Map<string, string>;
}

export function memoryStorage(): MemoryStorage {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => { data.set(key, String(value)); },
    removeItem: (key) => { data.delete(key); },
    clear: () => data.clear(),
  };
}

export interface BrowserStub {
  location: { search: string; pathname: string };
  document: { cookie: string };
  localStorage: MemoryStorage;
  sessionStorage: MemoryStorage;
}

/** Install window/document/localStorage stubs. Undo with vi.unstubAllGlobals(). */
export function installBrowser(opts: { search?: string; pathname?: string; cookie?: string } = {}): BrowserStub {
  const stub: BrowserStub = {
    location: { search: opts.search ?? "", pathname: opts.pathname ?? "/" },
    document: { cookie: opts.cookie ?? "" },
    localStorage: memoryStorage(),
    sessionStorage: memoryStorage(),
  };
  vi.stubGlobal("window", {
    location: stub.location,
    localStorage: stub.localStorage,
    sessionStorage: stub.sessionStorage,
  });
  vi.stubGlobal("document", stub.document);
  return stub;
}

/** Simulate an in-app navigation (the SPA drops the landing query string). */
export function navigate(stub: BrowserStub, pathname: string, search = ""): void {
  stub.location.pathname = pathname;
  stub.location.search = search;
}
