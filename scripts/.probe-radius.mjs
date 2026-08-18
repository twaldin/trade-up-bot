import puppeteer from "puppeteer";
const b = await puppeteer.launch({ headless:"new", args:["--no-sandbox","--disable-dev-shm-usage"], defaultViewport:{width:1600,height:1000} });
const p = await b.newPage();
await p.goto("http://127.0.0.1:5173/preview/trade-ups", { waitUntil:"domcontentloaded", timeout:90000 });
await p.waitForSelector(".preview-currency__trigger", { timeout:30000 });
await new Promise(r=>setTimeout(r,2500));
await p.evaluate(() => [...document.querySelectorAll("button")].find(x=>x.textContent.trim()==="Light")?.click());
await new Promise(r=>setTimeout(r,900));
await p.click(".preview-currency__trigger");
await new Promise(r=>setTimeout(r,500));
const out = await p.evaluate(() => {
  const bad = [];
  for (const el of document.querySelectorAll("[data-preview] *")) {
    const r = getComputedStyle(el).borderRadius;
    if (r && r !== "0px" && r !== "50%" && !["4px","6px"].includes(r.split(" ")[0])) {
      bad.push({ r, tag: el.tagName, cls: String(el.className).slice(0,80), txt: (el.textContent||"").slice(0,30) });
    }
  }
  return bad.slice(0,10);
});
console.log(JSON.stringify(out,null,2));
// landing
await p.goto("http://127.0.0.1:5173/preview", { waitUntil:"domcontentloaded", timeout:90000 });
await new Promise(r=>setTimeout(r,2500));
const land = await p.evaluate(() => {
  const bad = [];
  for (const el of document.querySelectorAll("[data-preview] *")) {
    const r = getComputedStyle(el).borderRadius;
    if (r && r !== "0px" && r !== "50%" && !["4px","6px"].includes(r.split(" ")[0])) {
      bad.push({ r, cls: String(el.className).slice(0,60) });
    }
  }
  return bad.slice(0,12);
});
console.log(JSON.stringify(land,null,2));
await b.close();
