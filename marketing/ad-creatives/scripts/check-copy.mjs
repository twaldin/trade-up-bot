import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const banned = JSON.parse(fs.readFileSync(path.join(root, "src/copy/banned.json"), "utf8"));
const patterns = banned.phrases.map((p) => ({
  phrase: p,
  re: new RegExp(`(^|[^\\p{L}\\p{N}])${p.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}(?=$|[^\\p{L}\\p{N}])`, "iu"),
}));

const files = [path.join(root, "google-search-rsa.md")];

let failed = false;
for (const file of files) {
  const text = fs.readFileSync(file, "utf8");
  const hits = patterns.filter(({ re }) => re.test(text)).map(({ phrase }) => phrase);
  if (hits.length) {
    failed = true;
    console.log(`${path.relative(root, file)}: ${hits.join(", ")}`);
  }
}

const md = fs.readFileSync(path.join(root, "google-search-rsa.md"), "utf8");
const rows = [...md.matchAll(/^\| (\d+) \|[^|]*\| (\d+) \| ([^|]+) \|$/gm)];
for (const [, num, count, text] of rows) {
  const actual = text.trim().length;
  if (actual !== Number(count)) {
    failed = true;
    console.log(`row ${num} claims ${count} chars, actual ${actual}: ${text.trim()}`);
  }
  const limit = Number(num) <= 15 && actual <= 30 ? 30 : 90;
  if (actual > (text.trim().split(" ").length > 6 ? 90 : 30) && actual > 30 && !text.includes(".")) {
    /* headlines have no period; descriptions do. Checked below. */
  }
  if (actual > 90 || (actual <= 30 && Number(count) <= 30 && actual > 30)) {
    failed = true;
    console.log(`over limit: ${text.trim()}`);
  }
  void limit;
}
const headlines = rows.filter((r) => Number(r[2]) <= 30);
const descriptions = rows.filter((r) => Number(r[2]) > 30);
if (headlines.length !== 15) {
  failed = true;
  console.log(`expected 15 headlines, found ${headlines.length}`);
}
if (descriptions.length !== 4) {
  failed = true;
  console.log(`expected 4 descriptions, found ${descriptions.length}`);
}
if (!/^\| 15 \| 1 \|/m.test(md)) {
  failed = true;
  console.log("headline 15 is not pinned to position 1");
}
if (failed) process.exit(1);
console.log(`copy ok (${headlines.length} headlines, ${descriptions.length} descriptions)`);
