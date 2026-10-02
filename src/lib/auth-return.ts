// Login and signup return values stashed by the head strip script in index.html.
// The URL no longer has auth or lid by the time React runs.

export interface AuthReturnStash {
  auth?: string | null;
  lid?: string | null;
}

export interface AuthReturn {
  auth: "new" | "return";
  lid: string | null;
}

declare global {
  interface Window {
    __tubAuthReturn?: AuthReturnStash | null;
    __tubPageLocation?: string;
  }
}

export function parseAuthReturn(stash: AuthReturnStash | null | undefined): AuthReturn | null {
  if (!stash) return null;
  if (stash.auth !== "new" && stash.auth !== "return") return null;
  const lid = typeof stash.lid === "string" ? stash.lid : null;
  return { auth: stash.auth, lid };
}

function browserWindow(): Window | undefined {
  const scope = globalThis as typeof globalThis & { window?: Window };
  return scope.window;
}

function defaultRead(): AuthReturnStash | null | undefined {
  return browserWindow()?.__tubAuthReturn;
}

function defaultClear(): void {
  const current = browserWindow();
  if (current) current.__tubAuthReturn = null;
}

/** Read the head-script stash once. Does not consult location.search. */
export function consumeAuthReturn(
  read: () => AuthReturnStash | null | undefined = defaultRead,
  clear: () => void = defaultClear,
): AuthReturn | null {
  const parsed = parseAuthReturn(read());
  if (parsed) clear();
  return parsed;
}
