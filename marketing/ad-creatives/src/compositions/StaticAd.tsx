import React from "react";
import { AbsoluteFill, Img, staticFile } from "remotion";
import type { Take } from "../facts";
import { C, FONT } from "../theme";
import { Brand } from "../components/Brand";
import { Emphasis } from "../components/Emphasis";
import { BigRows, RangeBar } from "../components/Graphics";

type ShotRef = { take: string; shot: string };

export type StaticVisual =
  | { type: "shot"; shot: ShotRef; label?: string }
  | { type: "shots"; items: (ShotRef & { label: string })[] }
  | { type: "split"; left: { title: string; note: string }; right: ShotRef & { title: string; note: string } }
  | { type: "number"; label: string; value: string; detail: string }
  | { type: "boundary"; kicker: string; rows: { k: string; v: string }[]; stopAt: number; size: number }
  | { type: "fees"; rows: { market: string; buyer: string }[]; label: string; note: string }
  | { type: "listings"; label: string; rows: { n: string; name: string; market: string; float: string; price: string }[] };

export type StaticAdProps = {
  id: string;
  angle: string;
  format: "square" | "portrait" | "vertical";
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
  const box: React.CSSProperties = { width: "100%", display: "flex", flexDirection: "column", gap: 16 };
  switch (v.type) {
    case "shot": {
      const s = shotSrc(takes, v.shot);
      return (
        <div data-visual="shot" style={{ ...box, flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
          {v.label && <Kicker>{v.label}</Kicker>}
          <div style={{ flex: 1, minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center", width: "100%" }}>
            <Framed src={s.src} />
          </div>
        </div>
      );
    }
    case "shots":
      return (
        <div data-visual="shots" style={{ ...box, flexDirection: "column" }}>
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
        <div data-visual="split" style={{ ...box, flexDirection: "row" }}>
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
    case "number":
      return (
        <div data-visual="number" style={{ ...box, flexDirection: "column", justifyContent: "center" }}>
          <Kicker>{v.label}</Kicker>
          <div style={{ fontFamily: FONT.mono, fontSize: 96, lineHeight: 1, color: C.text, letterSpacing: -2 }}>{v.value}</div>
          <div style={{ fontFamily: FONT.body, fontSize: 28, color: C.muted, marginTop: 18, lineHeight: 1.35 }}>{v.detail}</div>
        </div>
      );
    case "boundary":
      return (
        <div data-visual="boundary" style={{ ...box, flexDirection: "column", justifyContent: "center", gap: 28 }}>
          <Kicker>{v.kicker}</Kicker>
          <RangeBar stopAt={v.stopAt} instant />
          <BigRows rows={v.rows} size={v.size} instant />
        </div>
      );
    case "fees":
      return (
        <div data-visual="fees" style={{ ...box, flexDirection: "column", justifyContent: "center" }}>
          <Kicker>{v.label}</Kicker>
          <div style={{ border: `1px solid ${C.lineHard}`, borderRadius: 12, overflow: "hidden", background: C.panel }}>
            {[{ market: "Marketplace", buyer: "Buyer fee" }, ...v.rows].map((r, i) => (
              <div
                key={r.market}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1.4fr 1fr",
                  padding: "16px 26px",
                  borderTop: i ? `1px solid ${C.lineSoft}` : undefined,
                  fontFamily: i ? FONT.mono : FONT.body,
                  fontSize: i ? 32 : 22,
                  color: i ? C.text : C.muted,
                  background: i ? undefined : C.overlay,
                }}
              >
                <span style={{ fontFamily: FONT.body, fontWeight: i ? 600 : 400 }}>{r.market}</span>
                <span>{r.buyer}</span>
              </div>
            ))}
          </div>
          <div style={{ fontFamily: FONT.body, fontSize: 28, color: C.text, marginTop: 18, lineHeight: 1.35 }}>{v.note}</div>
        </div>
      );
    case "listings":
      return (
        <div data-visual="listings" style={{ ...box, flexDirection: "column", justifyContent: "center" }}>
          <Kicker>{v.label}</Kicker>
          <div style={{ border: `1px solid ${C.lineHard}`, borderRadius: 12, overflow: "hidden", background: C.panel }}>
            {v.rows.map((r, i) => (
              <div
                key={r.n}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                  padding: "4px 14px",
                  borderTop: i ? `1px solid ${C.lineSoft}` : undefined,
                  color: C.text,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
                  <span style={{ fontFamily: FONT.body, fontWeight: 600, fontSize: 26 }}>{r.n} {r.name}</span>
                  <span style={{ fontFamily: FONT.mono, fontSize: 26 }}>{r.price}</span>
                </div>
                <div style={{ fontFamily: FONT.mono, fontSize: 22, color: C.muted }}>{r.market} · {r.float}</div>
              </div>
            ))}
          </div>
        </div>
      );
  }
};

export const StaticAd: React.FC<StaticAdProps> = (p) => {
  const tall = p.format === "vertical";
  const padTop = tall ? 270 : 48;
  const padBottom = tall ? 696 : 48;
  const headline = tall ? 56 : p.format === "portrait" ? 48 : 44;
  return (
    <AbsoluteFill
      style={{
        background: C.bg,
        paddingTop: padTop,
        paddingBottom: padBottom,
        paddingLeft: 48,
        paddingRight: 48,
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        gap: 12,
        fontFamily: FONT.body,
        boxSizing: "border-box",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16 }}>
        <Brand size={tall ? 32 : 26} />
        <span style={{ fontFamily: FONT.mono, fontSize: 22, color: C.text }}>{p.url}</span>
      </div>
      <div style={{ fontWeight: 600, fontSize: headline, lineHeight: 1.12, letterSpacing: -0.8, color: C.text }}>
        <Emphasis text={p.headline} emphasis={p.emphasis} />
      </div>
      <div style={{ fontSize: 28, lineHeight: 1.35, color: C.text }}>{p.sub}</div>
      <Visual v={p.visual} takes={p.takes} />
      <div style={{ alignSelf: "flex-start", background: C.accent, color: C.onAccent, fontWeight: 600, fontSize: 28, borderRadius: 8, padding: "14px 26px" }}>{p.cta}</div>
      <div style={{ fontFamily: FONT.mono, fontSize: 28, color: C.text, lineHeight: 1.3 }}>{p.source}</div>
      <div style={{ fontFamily: FONT.mono, fontSize: 28, color: C.text, border: `1px solid ${C.lineHard}`, borderRadius: 8, padding: "12px 16px", textAlign: "center" }}>
        {p.disclaimer}
      </div>
    </AbsoluteFill>
  );
};
