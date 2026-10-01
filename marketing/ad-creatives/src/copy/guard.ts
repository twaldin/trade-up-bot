import banned from "./banned.json";

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const PATTERNS = banned.phrases.map((p) => ({ phrase: p, re: new RegExp(`(^|[^\\p{L}\\p{N}])${escape(p)}(?=$|[^\\p{L}\\p{N}])`, "iu") }));

export const bannedIn = (text: string): string[] => PATTERNS.filter(({ re }) => re.test(text)).map(({ phrase }) => phrase);

const collect = (value: unknown, out: string[]) => {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => collect(v, out));
  else if (value && typeof value === "object") Object.values(value).forEach((v) => collect(v, out));
};

/** Throws if any on-screen string in a creative's copy uses a banned phrase. */
export const assertCleanCopy = (id: string, copy: unknown): void => {
  const strings: string[] = [];
  collect(copy, strings);
  const hits = strings.flatMap((s) => bannedIn(s).map((p) => `"${p}" in: ${s}`));
  if (hits.length) throw new Error(`[${id}] banned copy:\n${hits.join("\n")}`);
};
