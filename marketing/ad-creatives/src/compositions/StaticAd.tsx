import React from "react";
import { AbsoluteFill, Img, staticFile } from "remotion";
import type { Take } from "../facts";
import { C, FONT } from "../theme";
import { Brand } from "../components/Brand";
import { Emphasis } from "../components/Emphasis";

type ShotRef = { take: string; shot: string };

export type StaticVisual =
  | { type: "shot"; shot: ShotRef; label?: string }
  | { type: "shots"; items: (ShotRef & { label: string })[] }
  | { type: "split"; left: { title: string; note: string }; right: ShotRef & { title: string; note: string } }
  | { type: "number"; label: string; value: string; detail: string; shot: ShotRef }
  | { type: "fees"; rows: { market: string; buyer: string; seller: string }[]; label: string }
  | { type: "listings"; label: string; rows: { n: string; name: string; market: string; float: string; price: string }[] };

export type StaticAdProps = {
  id: string;
  angle: string;
  format: "square" | "portrait";
  headline: string;
  emphasis?: string[];
  sub: string;
  visual: StaticVisual;
  cta: string;
  url: string;
  disclaimer: string;
  source: string;
  takes: Record<string, Take>;
};

const shotSrc = (takes: Record<string, Take>, ref: ShotRef) => {
  const s = takes[ref.take]?.screenshots[ref.shot];
  if (!s) throw new Error(`screenshot ${ref.take}/${ref.shot} missing`);
  return { src: staticFile(`captures/${s.file}`), ratio: s.cssWidth / s.cssHeight };
};

const Kicker: React.FC<{ children: React.ReactNode; color?: string }> = ({ children, color = C.muted }) => (
  <div style={{ fontFamily: FONT.mono, fontSize: 22, color, letterSpacing: 0.6, textTransform: "uppercase", marginBottom: 12 }}>{children}</div>
);

const Framed: React.FC<{ src: string; style?: React.CSSProperties }> = ({ src, style }) => (
  <Img
    src={src}
    style={{ display: "block", maxWidth: "100%", maxHeight: "100%", objectFit: "contain", borderRadius: 10, border: `1px solid ${C.lineHard}`, ...style }}
  />
);

const Visual: React.FC<{ v: StaticVisual; takes: Record<string, Take> }> = ({ v, takes }) => {
  const box: React.CSSProperties = { width: "100%", height: "100%", display: "flex", gap: 24 };
  switch (v.type) {
    case "shot": {
      const s = shotSrc(takes, v.shot);
      return (
        <div style={{ ...box, flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
          {v.label && <Kicker>{v.label}</Kicker>}
          <div style={{ flex: 1, minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center", width: "100%" }}>
            <Framed src={s.src} />
          </div>
        </div>
      );
    }
    case "shots":
      return (
        <div style={{ ...box, flexDirection: "column" }}>
          {v.items.map((it) => (
            <div key={it.shot} style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
              <Kicker>{it.label}</Kicker>
              <div style={{ flex: 1, minHeight: 0, display: "flex", justifyContent: "flex-start" }}>
                <Framed src={shotSrc(takes, it).src} />
              </div>
            </div>
          ))}
        </div>
      );
    case "split": {
      const s = shotSrc(takes, v.right);
      return (
        <div style={{ ...box, flexDirection: "row" }}>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", background: C.sunken, border: `1px solid ${C.lineSoft}`, borderRadius: 12, padding: 24 }}>
            <Kicker>{v.left.title}</Kicker>
            <div style={{ flex: 1, position: "relative", filter: "blur(1.5px)", opacity: 0.75 }}>
              {/* Schematic only: one flat line = one price for every float in a condition. No data. */}
              <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, top: 0, borderLeft: `2px solid ${C.lineHard}`, borderBottom: `2px solid ${C.lineHard}` }} />
              <div style={{ position: "absolute", left: "6%", right: "6%", top: "46%", height: 6, borderRadius: 3, background: C.subtle }} />
            </div>
            <div style={{ fontFamily: FONT.body, fontSize: 22, color: C.muted, marginTop: 14, lineHeight: 1.3 }}>{v.left.note}</div>
          </div>
          <div style={{ flex: 1.25, display: "flex", flexDirection: "column", background: C.panel, border: `1px solid ${C.accentText}`, borderRadius: 12, padding: 24 }}>
            <Kicker color={C.accent}>{v.right.title}</Kicker>
            <div style={{ flex: 1, minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Framed src={s.src} />
            </div>
            <div style={{ fontFamily: FONT.body, fontSize: 22, color: C.muted, marginTop: 14, lineHeight: 1.3 }}>{v.right.note}</div>
          </div>
        </div>
      );
    }
    case "number": {
      const s = shotSrc(takes, v.shot);
      return (
        <div style={{ ...box, flexDirection: "row", alignItems: "center" }}>
          <div style={{ flex: 1.1, display: "flex", flexDirection: "column" }}>
            <Kicker>{v.label}</Kicker>
            <div style={{ fontFamily: FONT.mono, fontSize: 150, lineHeight: 1, color: C.text, letterSpacing: -4 }}>{v.value}</div>
            <div style={{ fontFamily: FONT.body, fontSize: 26, color: C.muted, marginTop: 18, lineHeight: 1.35 }}>{v.detail}</div>
          </div>
          <div style={{ flex: 1, height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Framed src={s.src} />
          </div>
        </div>
      );
    }
    case "fees":
      return (
        <div style={{ ...box, flexDirection: "column", justifyContent: "center" }}>
          <Kicker>{v.label}</Kicker>
          <div style={{ border: `1px solid ${C.lineHard}`, borderRadius: 12, overflow: "hidden", background: C.panel }}>
            {[{ market: "Marketplace", buyer: "Buyer fee", seller: "Seller fee" }, ...v.rows].map((r, i) => (
              <div
                key={r.market}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1.2fr 1fr 1fr",
                  padding: "18px 26px",
                  borderTop: i ? `1px solid ${C.lineSoft}` : undefined,
                  fontFamily: i ? FONT.mono : FONT.body,
                  fontSize: i ? 32 : 22,
                  color: i ? C.text : C.muted,
                  background: i ? undefined : C.overlay,
                }}
              >
                <span style={{ fontFamily: FONT.body, fontWeight: i ? 600 : 400 }}>{r.market}</span>
                <span>{r.buyer}</span>
                <span>{r.seller}</span>
              </div>
            ))}
          </div>
        </div>
      );
    case "listings":
      return (
        <div style={{ ...box, flexDirection: "column", justifyContent: "center" }}>
          <Kicker>{v.label}</Kicker>
          <div style={{ border: `1px solid ${C.lineHard}`, borderRadius: 12, overflow: "hidden", background: C.panel }}>
            {v.rows.map((r, i) => (
              <div
                key={r.n}
                style={{
                  display: "grid",
                  gridTemplateColumns: "52px 1.6fr 70px 110px 90px",
                  padding: "14px 22px",
                  borderTop: i ? `1px solid ${C.lineSoft}` : undefined,
                  fontFamily: FONT.mono,
                  fontSize: 28,
                  color: C.text,
                  alignItems: "center",
                }}
              >
                <span style={{ color: C.subtle }}>{r.n}</span>
                <span style={{ fontFamily: FONT.body, fontWeight: 600 }}>{r.name}</span>
                <span style={{ color: C.muted }}>{r.market}</span>
                <span>{r.float}</span>
                <span>{r.price}</span>
              </div>
            ))}
          </div>
        </div>
      );
  }
};

export const StaticAd: React.FC<StaticAdProps> = (p) => {
  const sq = p.format === "square";
  const pad = 64;
  return (
    <AbsoluteFill style={{ background: C.bg, padding: pad, display: "flex", flexDirection: "column", fontFamily: FONT.body }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <Brand size={sq ? 28 : 32} />
        <span style={{ fontFamily: FONT.mono, fontSize: sq ? 22 : 24, color: C.muted }}>{p.url}</span>
      </div>
      <div style={{ marginTop: sq ? 34 : 56, fontWeight: 600, fontSize: sq ? 62 : 74, lineHeight: 1.06, letterSpacing: -1.4, color: C.text }}>
        <Emphasis text={p.headline} emphasis={p.emphasis} />
      </div>
      <div style={{ marginTop: sq ? 16 : 24, fontSize: sq ? 27 : 31, lineHeight: 1.35, color: C.muted, maxWidth: 930 }}>{p.sub}</div>
      <div style={{ flex: 1, minHeight: 0, marginTop: sq ? 26 : 44, marginBottom: sq ? 24 : 40 }}>
        <Visual v={p.visual} takes={p.takes} />
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
        <div style={{ background: C.accent, color: C.onAccent, fontWeight: 600, fontSize: sq ? 28 : 32, borderRadius: 8, padding: sq ? "14px 26px" : "16px 30px" }}>{p.cta}</div>
        <div style={{ fontFamily: FONT.mono, fontSize: sq ? 19 : 21, color: C.subtle, lineHeight: 1.35, flex: 1 }}>{p.source}</div>
      </div>
      <div
        style={{
          marginTop: sq ? 20 : 28,
          fontFamily: FONT.mono,
          fontSize: sq ? 22 : 24,
          color: C.text,
          border: `1px solid ${C.lineHard}`,
          borderRadius: 8,
          padding: "12px 18px",
          textAlign: "center",
        }}
      >
        {p.disclaimer}
      </div>
    </AbsoluteFill>
  );
};
