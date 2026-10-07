// The preload scanner requests parser-visible stylesheets, scripts, and
// images before any inline script runs, so replaceState in the head is too
// late for those URLs: same-origin Referer still carries auth and lid.
// Same-origin link/script tags are removed and document.written after the
// strip. Same-origin images stay in the markup (hydration) and get
// referrerpolicy=strict-origin, which the scanner honors.
import { AUTH_RETURN_STRIP_SOURCE } from "./auth-return-strip.js";

const DEFER_RELS = new Set(["icon", "shortcut", "preload", "modulepreload", "stylesheet"]);
const DEFER_STATEMENT = /[ \t]*\/\* tub-defer \*\/ document\.write\(("(?:\\.|[^"\\])*")\);\n?/g;
const BOOT_RE = /\n?[ \t]*<script>\s*\/\* tub-defer-boot \*\/[\s\S]*?<\/script>/g;

function attr(tag: string, name: string): string | null {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, "i"));
  if (!match) return null;
  return match[1] ?? match[2] ?? match[3] ?? "";
}

function sameOriginRef(value: string | null): boolean {
  if (!value) return false;
  if (value.startsWith("/") && !value.startsWith("//")) return true;
  return value === "https://tradeupbot.app" || value.startsWith("https://tradeupbot.app/");
}

function tagStartsAt(html: string, index: number, name: string): boolean {
  if (!html.startsWith(`<${name}`, index)) return false;
  const next = html[index + name.length + 1];
  return next === ">" || next === "/" || next === " " || next === "\n" || next === "\t" || next === "\r";
}

function elementEnd(html: string, index: number, name: string): number {
  if (name === "link" || name === "img" || name === "source") {
    const end = html.indexOf(">", index);
    return end === -1 ? html.length : end + 1;
  }
  const end = html.toLowerCase().indexOf(`</${name}>`, index);
  return end === -1 ? html.length : end + `</${name}>`.length;
}

function shouldDeferLink(tag: string): boolean {
  const rels = (attr(tag, "rel") ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  return rels.some((rel) => DEFER_RELS.has(rel)) && sameOriginRef(attr(tag, "href"));
}

function shouldDeferScript(tag: string): boolean {
  return sameOriginRef(attr(tag, "src")) && !tag.includes("__tubAuthReturn");
}

function withImageReferrer(tag: string): string {
  if (/referrerpolicy\s*=/i.test(tag)) return tag;
  if (!sameOriginRef(attr(tag, "src"))) return tag;
  return tag.replace(/\s*\/?>$/, (end) => {
    const suffix = end.startsWith(" ") ? end : ` ${end}`;
    return ` referrerpolicy="strict-origin"${suffix}`;
  });
}

function resourceKey(tag: string): string {
  return `${attr(tag, "href") ?? ""}|${attr(tag, "src") ?? ""}`;
}

function deferStatement(tag: string): string {
  const literal = JSON.stringify(tag.trim()).replace(/</g, "\\u003c").replace(/>/g, "\\u003e");
  return `/* tub-defer */ document.write(${literal});`;
}

function takeDeferredWrites(html: string): { html: string; tags: string[] } {
  const tags: string[] = [];
  const next = html.replace(DEFER_STATEMENT, (_line, quoted: string) => {
    const parsed: unknown = JSON.parse(quoted);
    if (typeof parsed === "string") tags.push(parsed);
    return "";
  });
  return { html: next, tags };
}

function collectTags(html: string): { html: string; tags: string[] } {
  const tags: string[] = [];
  let out = "";
  let index = 0;
  while (index < html.length) {
    const rest = html.slice(index);
    const link = rest.startsWith("<link") && tagStartsAt(html, index, "link");
    const script = rest.startsWith("<script") && tagStartsAt(html, index, "script");
    const style = rest.startsWith("<style") && tagStartsAt(html, index, "style");
    const img = rest.startsWith("<img") && tagStartsAt(html, index, "img");
    if (link || script || img) {
      const name = link ? "link" : script ? "script" : "img";
      const end = elementEnd(html, index, name);
      let tag = html.slice(index, end);
      if (name === "link" && shouldDeferLink(tag)) {
        tags.push(tag.trim());
        index = end;
        if (html[index] === "\n") index += 1;
        continue;
      }
      if (name === "script" && shouldDeferScript(tag)) {
        tags.push(tag.trim());
        index = end;
        if (html[index] === "\n") index += 1;
        continue;
      }
      if (name === "img") tag = withImageReferrer(tag);
      out += tag;
      index = end;
      continue;
    }
    if (style) {
      const end = elementEnd(html, index, "style");
      out += html.slice(index, end);
      index = end;
      continue;
    }
    out += html[index];
    index += 1;
  }
  return { html: out, tags };
}

function takeBoot(html: string): { html: string; tags: string[] } {
  const tags: string[] = [];
  const next = html.replace(BOOT_RE, (block) => {
    tags.push(...takeDeferredWrites(block).tags);
    return "";
  });
  return { html: next, tags };
}

function insertBoot(html: string, statements: string[]): string {
  if (statements.length === 0) return html;
  const at = html.indexOf(AUTH_RETURN_STRIP_SOURCE);
  const marker = at === -1 ? html.indexOf("__tubAuthReturn") : at;
  if (marker === -1) return html;
  const end = html.indexOf("</script>", marker);
  if (end === -1) return html;
  const insertAt = end + "</script>".length;
  const body = statements.map((statement) => `      ${statement}`).join("\n");
  const boot = `\n    <script>\n      /* tub-defer-boot */\n${body}\n    </script>`;
  return html.slice(0, insertAt) + boot + html.slice(insertAt);
}

/** Move same-origin head assets to after the auth/lid strip. Idempotent. */
export function deferSameOriginSubresources(html: string): string {
  if (!html.includes("__tubAuthReturn") && !html.includes(AUTH_RETURN_STRIP_SOURCE)) return html;
  const recovered = takeBoot(html);
  const collected = collectTags(recovered.html);
  const byKey = new Map<string, string>();
  for (const tag of [...recovered.tags, ...collected.tags]) {
    byKey.set(resourceKey(tag), tag.trim());
  }
  return insertBoot(collected.html, [...byKey.values()].map(deferStatement));
}
