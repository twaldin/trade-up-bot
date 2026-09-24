import React from "react";
import { AbsoluteFill, Sequence, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import type { Take } from "../facts";
import { C, FONT, FPS, type Format } from "../theme";
import { Brand } from "../components/Brand";
import { Emphasis } from "../components/Emphasis";
import { Footage, fadeIn, type Focus, type FocusKey, type FootageSpec } from "../components/Footage";
import { EndCard, type EndCardProps } from "../components/EndCard";
import { BigRows, RangeBar } from "../components/Graphics";
import { HONESTY } from "../live-read";

export type Callout = { label: string; value: string; note?: string; tone?: "plain" | "plus" | "loss"; valueSize?: number };

export type Graphic =
  | { type: "range"; stopAt: number; kicker: string; rows: { k: string; v: string }[]; size?: number }
  | { type: "figure"; kicker: string; value: string; note: string; tone?: "plain" | "plus" | "loss"; size?: number }
  | { type: "stack"; title: string; rows: { k: string; v: string; tone?: "plain" | "plus" | "loss" }[]; size?: number };

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
  switch (format) {
    case "square":
      return {
        brand: { x: 48, y: 28, size: 22 },
        honesty: { x: 48, y: 72, w: 984, h: 36, size: 20 },
        caption: { x: 48, y: 112, w: 984, h: 120, size: 36 },
        panel: { x: 48, y: 244, w: 984, h: 700 },
        radius: 12,
        footnote: { x: 48, y: 960, w: 984, h: 80, size: 18 },
        pointerScale: 0.85,
      };
    case "portrait":
      return {
        brand: { x: 56, y: 36, size: 24 },
        honesty: { x: 56, y: 84, w: 968, h: 40, size: 22 },
        caption: { x: 56, y: 132, w: 968, h: 140, size: 40 },
        panel: { x: 56, y: 284, w: 968, h: 860 },
        radius: 12,
        footnote: { x: 56, y: 1160, w: 968, h: 120, size: 20 },
        pointerScale: 0.95,
      };
    case "landscape":
      return {
        brand: { x: 72, y: 36, size: 24 },
        honesty: { x: 72, y: 88, w: 1776, h: 40, size: 22 },
        caption: { x: 72, y: 140, w: 700, h: 700, size: 42 },
        panel: { x: 820, y: 140, w: 1020, h: 760 },
        radius: 12,
        footnote: { x: 72, y: 980, w: 1776, h: 60, size: 20 },
        pointerScale: 1,
      };
    default:
      // 9:16 safe band is y 270–1250 (top 14%, bottom 35% clear).
      return {
        brand: { x: 72, y: 278, size: 26 },
        honesty: { x: 280, y: 278, w: 728, h: 40, size: 22 },
        caption: { x: 72, y: 340, w: 936, h: 140, size: 40 },
        panel: { x: 72, y: 490, w: 936, h: 400 },
        radius: 14,
        footnote: { x: 72, y: 910, w: 936, h: 150, size: 22 },
        pointerScale: 1,
      };
  }
};

const toneColor = (tone: Callout["tone"]) => (tone === "plus" ? C.accent : tone === "loss" ? C.loss : C.text);

const CalloutCard: React.FC<{ c: Callout; frame: number }> = ({ c, frame }) => (
  <div
    style={{
      position: "absolute",
      left: 20,
      bottom: 16,
      opacity: fadeIn(frame, 0, 6),
      background: "rgba(38,37,35,0.96)",
      border: `1px solid ${C.lineHard}`,
      borderRadius: 10,
      padding: "12px 18px",
      maxWidth: "92%",
    }}
  >
    <div style={{ fontFamily: FONT.mono, fontSize: 20, color: C.muted }}>{c.label}</div>
    <div style={{ fontFamily: FONT.mono, fontSize: c.valueSize ?? 72, color: toneColor(c.tone), lineHeight: 1.05, fontWeight: 500 }}>{c.value}</div>
    {c.note && <div style={{ fontFamily: FONT.body, fontSize: 22, color: C.muted, marginTop: 4 }}>{c.note}</div>}
  </div>
);

const GraphicView: React.FC<{ g: Graphic }> = ({ g }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = interpolate(frame, [0, Math.round(0.4 * fps)], [0.92, 1], { extrapolateRight: "clamp" });
  if (g.type === "range") {
    return (
      <div style={{ height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", padding: "28px 36px", gap: 28 }}>
        <div style={{ fontFamily: FONT.mono, fontSize: 22, color: C.muted, letterSpacing: 0.4 }}>{g.kicker}</div>
        <RangeBar stopAt={g.stopAt} />
        <BigRows rows={g.rows} size={g.size ?? 80} />
      </div>
    );
  }
  if (g.type === "figure") {
    return (
      <div style={{ height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", padding: "28px 36px", transform: `scale(${pop})` }}>
        <div style={{ fontFamily: FONT.mono, fontSize: 22, color: C.muted }}>{g.kicker}</div>
        <div style={{ fontFamily: FONT.mono, fontSize: g.size ?? 96, color: toneColor(g.tone), letterSpacing: -1, lineHeight: 1.05 }}>{g.value}</div>
        <div style={{ fontFamily: FONT.body, fontSize: 28, color: C.muted, marginTop: 12, lineHeight: 1.3 }}>{g.note}</div>
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
          color: C.muted,
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
