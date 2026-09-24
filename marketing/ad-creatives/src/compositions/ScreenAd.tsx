import React from "react";
import { AbsoluteFill, Sequence, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import type { Take } from "../facts";
import { C, FONT, FPS, safeBand, type Format } from "../theme";
import { Brand } from "../components/Brand";
import { Emphasis } from "../components/Emphasis";
import { Footage, fadeIn, type Focus, type FocusKey, type FootageSpec } from "../components/Footage";
import { EndCard, type EndCardProps } from "../components/EndCard";
import { BigRows, RangeBar } from "../components/Graphics";
import { HONESTY } from "../live-read";

export type Callout = { label: string; value: string; note?: string; tone?: "plain" | "plus" | "loss"; valueSize?: number };

export type Graphic =
  | { type: "range"; stopAt: number; kicker: string; rows: { k: string; v: string }[]; size?: number }
  | { type: "figure"; kicker: string; value: string; note: string; tone?: "plain" | "plus" | "loss"; size?: number; motion?: boolean }
  | { type: "stack"; title: string; rows: { k: string; v: string; tone?: "plain" | "plus" | "loss" }[]; size?: number }
  | { type: "compare"; title: string; left: { k: string; v: string }; right: { k: string; v: string }; rows: { k: string; v: string }[] };

export type Scene = {
  id: string;
  seconds: number;
  caption: { text: string; emphasis?: string[] };
  footage?: FootageSpec;
  graphic?: Graphic;
  focusByFormat?: Partial<Record<Format, Focus | FocusKey[]>>;
  callout?: Callout;
  footnote?: string;
};

export type ScreenAdProps = {
  id: string;
  angle: string;
  format: Format;
  layout: "panel";
  scenes: Scene[];
  endCard: EndCardProps;
  footnote: string;
  takes: Record<string, Take>;
};

export const adDurationInFrames = (p: Pick<ScreenAdProps, "scenes" | "endCard">) =>
  Math.round((p.scenes.reduce((s, x) => s + x.seconds, 0) + p.endCard.seconds) * FPS);

type Rect = { x: number; y: number; w: number; h: number };
type Geometry = {
  brand: { x: number; y: number; size: number };
  honesty: Rect & { size: number };
  caption: Rect & { size: number };
  panel: Rect;
  radius: number;
  footnote: Rect & { size: number };
  pointerScale: number;
};

const geometry = (format: Format): Geometry => {
  const height = format === "square" ? 1080 : format === "portrait" ? 1350 : format === "landscape" ? 1080 : 1920;
  const band = safeBand(height);
  const foot = 28;
  if (format === "square") {
    return {
      brand: { x: 48, y: band.top, size: 22 },
      honesty: { x: 48, y: band.top + 32, w: 984, h: 36, size: foot },
      caption: { x: 48, y: band.top + 68, w: 984, h: 52, size: 28 },
      panel: { x: 48, y: band.top + 124, w: 984, h: 320 },
      radius: 12,
      footnote: { x: 48, y: band.top + 460, w: 984, h: 72, size: foot },
      pointerScale: 0.85,
    };
  }
  if (format === "portrait") {
    return {
      brand: { x: 56, y: band.top, size: 24 },
      honesty: { x: 56, y: band.top + 36, w: 968, h: 36, size: foot },
      caption: { x: 56, y: band.top + 80, w: 968, h: 90, size: 32 },
      panel: { x: 56, y: band.top + 178, w: 968, h: 380 },
      radius: 12,
      footnote: { x: 56, y: band.bottom - 110, w: 968, h: 100, size: foot },
      pointerScale: 0.95,
    };
  }
  if (format === "landscape") {
    return {
      brand: { x: 72, y: band.top, size: 24 },
      honesty: { x: 72, y: band.top + 40, w: 1776, h: 40, size: foot },
      caption: { x: 72, y: band.top + 90, w: 700, h: 400, size: 36 },
      panel: { x: 820, y: band.top + 90, w: 1020, h: 360 },
      radius: 12,
      footnote: { x: 72, y: band.bottom - 80, w: 1776, h: 70, size: foot },
      pointerScale: 1,
    };
  }
  return {
    brand: { x: 72, y: band.top + 4, size: 26 },
    honesty: { x: 72, y: band.top + 44, w: 936, h: 40, size: foot },
    caption: { x: 72, y: band.top + 92, w: 936, h: 120, size: 38 },
    panel: { x: 72, y: band.top + 220, w: 936, h: 500 },
    radius: 14,
    footnote: { x: 72, y: band.bottom - 150, w: 936, h: 140, size: foot },
    pointerScale: 1,
  };
};

const toneColor = (tone: Callout["tone"]) => (tone === "plus" ? C.accent : tone === "loss" ? C.loss : C.text);

const CalloutCard: React.FC<{ c: Callout; frame: number }> = ({ c, frame }) => (
        <div
    style={{
      position: "absolute",
      left: 20,
      top: 16,
      opacity: fadeIn(frame, 0, 6),
      background: "rgba(38,37,35,0.96)",
      border: `1px solid ${C.lineHard}`,
      borderRadius: 10,
      padding: "12px 18px",
      maxWidth: "92%",
      display: "flex",
      flexDirection: "column",
      gap: 16,
    }}
  >
        <div style={{ fontFamily: FONT.mono, fontSize: 24, color: C.muted, lineHeight: 1.15 }}>{c.label}</div>
      <div style={{ fontFamily: FONT.mono, fontSize: c.valueSize ?? 72, color: toneColor(c.tone), lineHeight: 1, fontWeight: 500 }}>{c.value}</div>
    {c.note && <div style={{ fontFamily: FONT.body, fontSize: 22, color: C.muted, marginTop: 4 }}>{c.note}</div>}
  </div>
);

const GraphicView: React.FC<{ g: Graphic }> = ({ g }) => {
  const frame = useCurrentFrame();
  const { fps, height } = useVideoConfig();
  if (g.type === "range") {
    const rowSize = height <= 1080 ? 36 : height <= 1350 ? 48 : Math.min(g.size ?? 64, 64);
    return (
      <div style={{ height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", padding: "12px 20px", gap: 12, overflow: "hidden" }}>
        <div style={{ fontFamily: FONT.mono, fontSize: 22, color: C.muted, letterSpacing: 0.4, lineHeight: 1.2, flexShrink: 0 }}>{g.kicker}</div>
        <RangeBar stopAt={g.stopAt} />
        <BigRows rows={g.rows} size={rowSize} />
      </div>
    );
  }
  if (g.type === "figure") {
    const fill = g.motion ? interpolate(frame, [0, Math.round(0.5 * fps)], [0, 1], { extrapolateRight: "clamp" }) : 1;
    return (
      <div style={{ height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", padding: "20px 28px", gap: 20 }}>
        <div style={{ fontFamily: FONT.mono, fontSize: 22, color: C.muted, lineHeight: 1.15 }}>{g.kicker}</div>
        <div style={{ fontFamily: FONT.mono, fontSize: Math.min(g.size ?? 96, height <= 1350 ? 72 : 88), color: toneColor(g.tone), letterSpacing: -1, lineHeight: 1 }}>{g.value}</div>
        {g.motion && (
          <div style={{ marginTop: 14, height: 10, width: "100%", background: C.lineHard, borderRadius: 5 }}>
            <div style={{ height: 10, width: `${fill * 100}%`, background: C.loss, borderRadius: 5 }} />
          </div>
        )}
        <div style={{ fontFamily: FONT.body, fontSize: 28, color: C.text, marginTop: 12, lineHeight: 1.3 }}>{g.note}</div>
      </div>
    );
  }
  if (g.type === "compare") {
    const hi = Math.min(g.rows.length - 1, Math.floor(frame / Math.max(1, Math.round(0.45 * fps))));
    return (
      <div style={{ height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", padding: "20px 28px", gap: 16 }}>
        <div style={{ fontFamily: FONT.mono, fontSize: 22, color: C.text }}>{g.title}</div>
        <div style={{ display: "flex", gap: 16 }}>
          {[g.left, g.right].map((side) => (
            <div key={side.k} style={{ flex: 1, background: C.overlay, border: `1px solid ${C.lineHard}`, borderRadius: 10, padding: "12px 16px" }}>
              <div style={{ fontFamily: FONT.body, fontSize: 22, color: C.text }}>{side.k}</div>
              <div style={{ fontFamily: FONT.mono, fontSize: 48, color: C.text, letterSpacing: -1 }}>{side.v}</div>
            </div>
          ))}
        </div>
        {g.rows.map((r, i) => (
          <div
            key={r.k}
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 12,
              padding: "8px 12px",
              borderRadius: 8,
              background: i === hi ? C.overlay : "transparent",
              border: `1px solid ${i === hi ? C.loss : C.lineSoft}`,
            }}
          >
            <span style={{ fontFamily: FONT.body, fontSize: 26, color: C.text, fontWeight: 600 }}>{r.k}</span>
            <span style={{ fontFamily: FONT.mono, fontSize: 32, color: C.loss }}>{r.v}</span>
          </div>
        ))}
      </div>
    );
  }
  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", padding: "24px 32px", gap: 8 }}>
      <div style={{ fontFamily: FONT.mono, fontSize: 22, color: C.muted, marginBottom: 8 }}>{g.title}</div>
      {g.rows.map((r) => (
        <div key={r.k} style={{ display: "flex", justifyContent: "space-between", gap: 16, borderTop: `1px solid ${C.lineSoft}`, padding: "10px 0" }}>
          <span style={{ fontFamily: FONT.body, fontSize: 28, color: C.text, fontWeight: 600 }}>{r.k}</span>
          <span style={{ fontFamily: FONT.mono, fontSize: g.size ?? 48, color: toneColor(r.tone) }}>{r.v}</span>
        </div>
      ))}
    </div>
  );
};

const SceneView: React.FC<{ scene: Scene; index: number; props: ScreenAdProps; g: Geometry }> = ({ scene, index, props, g }) => {
  const frame = useCurrentFrame();
  if (!scene.footage && !scene.graphic) throw new Error(`${props.id}/${scene.id} has no footage or graphic`);
  const capOpacity = index === 0 ? 1 : fadeIn(frame, 0, 6);
  return (
    <AbsoluteFill>
      <div
        style={{
          position: "absolute",
          left: g.panel.x,
          top: g.panel.y,
          width: g.panel.w,
          height: g.panel.h,
          borderRadius: g.radius,
          overflow: "hidden",
          background: C.panel,
          border: `1px solid ${C.lineHard}`,
        }}
        data-visual="panel"
      >
        {scene.footage && props.takes[scene.footage.take] && (
          <Footage
            spec={scene.footage}
            take={props.takes[scene.footage.take]}
            width={g.panel.w}
            height={g.panel.h}
            sceneSec={scene.seconds}
            pointerScale={g.pointerScale}
          />
        )}
        {scene.footage && !props.takes[scene.footage.take] && <AbsoluteFill />}
        {scene.graphic && <GraphicView g={scene.graphic} />}
        {scene.callout && <CalloutCard c={scene.callout} frame={frame} />}
      </div>
      <div
        style={{
          position: "absolute",
          left: g.caption.x,
          top: g.caption.y,
          width: g.caption.w,
          height: g.caption.h,
          display: "flex",
          alignItems: "flex-end",
          opacity: capOpacity,
          fontFamily: FONT.body,
          fontWeight: 600,
          fontSize: g.caption.size,
          lineHeight: 1.12,
          letterSpacing: -0.4,
          color: C.text,
        }}
      >
        <Emphasis text={scene.caption.text} emphasis={scene.caption.emphasis} />
      </div>
      <div
        style={{
          position: "absolute",
          left: g.footnote.x,
          top: g.footnote.y,
          width: g.footnote.w,
          fontFamily: FONT.mono,
          fontSize: g.footnote.size,
          lineHeight: 1.35,
          color: C.text,
        }}
      >
        {scene.footnote ?? props.footnote}
      </div>
    </AbsoluteFill>
  );
};

export const ScreenAd: React.FC<ScreenAdProps> = (props) => {
  const { fps } = useVideoConfig();
  const g = geometry(props.format);
  let at = 0;
  const seqs = props.scenes.map((scene, i) => {
    const from = Math.round(at * fps);
    at += scene.seconds;
    const len = Math.round(at * fps) - from;
    return (
      <Sequence key={scene.id} from={from} durationInFrames={len} name={scene.id}>
        <SceneView scene={scene} index={i} props={props} g={g} />
      </Sequence>
    );
  });
  const endFrom = Math.round(at * fps);
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      {seqs}
      {endFrom > 0 && (
        <Sequence durationInFrames={endFrom} name="chrome">
          <div style={{ position: "absolute", left: g.brand.x, top: g.brand.y }}>
            <Brand size={g.brand.size} />
          </div>
          <div
            style={{
              position: "absolute",
              left: g.honesty.x,
              top: g.honesty.y,
              width: g.honesty.w,
              fontFamily: FONT.mono,
              fontSize: g.honesty.size,
              color: C.text,
              fontWeight: 500,
              lineHeight: 1.2,
            }}
          >
            {HONESTY}
          </div>
        </Sequence>
      )}
      <Sequence from={endFrom} name="end-card">
        <EndCard {...props.endCard} format={props.format} />
      </Sequence>
    </AbsoluteFill>
  );
};
