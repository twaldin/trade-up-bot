// Minimal .env reader that matches how dotenvx (and dotenv) treat values,
// so scripts see the same value the api sees under `dotenvx run`.
// First assignment wins. Matching surrounding quotes (' " `) are stripped;
// unquoted values drop a trailing ` # comment`. Values are never logged.

export function parseDotenvValue(raw: string): string {
  const value = raw.trim();
  const quote = value[0];
  if ((quote === '"' || quote === "'" || quote === "`") && value.length >= 2) {
    const end = value.lastIndexOf(quote);
    if (end > 0) {
      const inner = value.slice(1, end);
      return quote === '"' ? inner.replace(/\\n/g, "\n").replace(/\\r/g, "\r") : inner;
    }
  }
  const hash = value.search(/\s#/);
  return (hash === -1 ? value : value.slice(0, hash)).trim();
}

export function parseDotenv(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of text.split("\n")) {
    const match = line.replace(/\r$/, "").match(/^(?:export\s+)?(\w+)\s*=(.*)$/);
    if (match && !out.has(match[1])) out.set(match[1], parseDotenvValue(match[2]));
  }
  return out;
}

/** Fill unset process env keys from .env text, the way dotenvx run does (no override). */
export function applyDotenv(text: string, env: NodeJS.ProcessEnv = process.env): void {
  for (const [key, value] of parseDotenv(text)) {
    if (!env[key]) env[key] = value;
  }
}
