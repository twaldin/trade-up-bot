/** True only when the response advertises JSON. Vite SPA fallbacks are text/html. */
export function isJsonContentType(res: Pick<Response, "headers">): boolean {
  const type = res.headers.get("content-type") ?? "";
  return /application\/json/i.test(type);
}

/** Parse JSON only when content-type is JSON. Never throws on HTML 200s. */
export async function readJsonIfJson<T>(res: Response): Promise<T | null> {
  if (!isJsonContentType(res)) return null;
  try {
    return await res.json() as T;
  } catch {
    return null;
  }
}
