import React from "react";
import { AbsoluteFill, Sequence, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import type { Take } from "../facts";
import { C, FONT, FPS, type Format } from "../theme";
import { Brand } from "../components/Brand";
import { Emphasis } from "../components/Emphasis";
import { Footage, fadeIn, type Focus, type FocusKey, type FootageSpec } from "../components/Footage";
import { EndCard, type EndCardProps } from "../components/EndCard";

export type Callout = { label: string; value: string; note?: string; tone?: "plain" | "profit" | "loss" };

export type Scene = {
  id: string;
  seconds: number;
  caption: { text: string; emphasis?: string[] };
  footage: FootageSpec;
  /** Different framing per output format (same clip, same timing). */
  focusByFormat?: Partial<Record<Format, Focus | FocusKey[]>>;
  callout?: Callout;
  footnote?: string;
};

export type ScreenAdProps = {
  id: string;
  angle: string;
  format: Format;
  layout: "panel" | "fullbleed";
  scenes: Scene[];
  endCard: EndCardProps;
  /** Shown under the footage when a scene has no footnote of its own. */
  footnote: string;
  takes: Record<string, Take>;
};

export const adDurationInFrames = (p: Pick<ScreenAdProps, "scenes" | "endCard">) =>
  Math.round((p.scenes.reduce((s, x) => s + x.seconds, 0) + p.endCard.seconds) * FPS);

type Rect = { x: number; y: number; w: number; h: number };
type Geometry = {
  brand?: { x: number; y: number; size: number };
  caption: Rect & { size: number; align: "left" | "center"; boxed: boolean };
  panel: Rect;
  radius: number;
  footnote: Rect & { size: number };
  pointerScale: number;
  callout: { size: number };
};

const geometry = (format: Format, layout: ScreenAdProps["layout"]): Geometry => {
  if (layout === "fullbleed") {
    return {
      caption: { x: 70, y: 300, w: 940, h: 380, size: 58, align: "center", boxed: true },
      panel: { x: 0, y: 0, w: 1080, h: 1920 },
      radius: 0,
      footnote: { x: 70, y: 1545, w: 940, h: 60, size: 25 },
      pointerScale: 1.4,
      callout: { size: 1.1 },
    };
  }
  switch (format) {
    case "square":
      return {
        brand: { x: 60, y: 44, size: 26 },
        caption: { x: 60, y: 104, w: 960, h: 220, size: 48, align: "left", boxed: false },
        panel: { x: 60, y: 344, w: 960, h: 630 },
        radius: 12,
        footnote: { x: 60, y: 996, w: 960, h: 50, size: 21 },
        pointerScale: 0.9,
        callout: { size: 0.85 },
      };
    case "landscape":
      return {
        brand: { x: 90, y: 92, size: 30 },
        caption: { x: 90, y: 200, w: 680, h: 640, size: 60, align: "left", boxed: false },
        panel: { x: 830, y: 92, w: 1000, h: 820 },
        radius: 14,
        footnote: { x: 830, y: 940, w: 1000, h: 60, size: 22 },
        pointerScale: 1,
        callout: { size: 0.95 },
      };
    default:
      return {
        brand: { x: 72, y: 150, size: 34 },
        caption: { x: 72, y: 250, w: 936, h: 400, size: 66, align: "left", boxed: false },
        panel: { x: 60, y: 680, w: 960, h: 900 },
        radius: 16,
        footnote: { x: 72, y: 1612, w: 936, h: 70, size: 26 },
        pointerScale: 1.1,
        callout: { size: 1 },
      };
  }
};

const CalloutCard: React.FC<{ c: Callout; scale: number; frame: number }> = ({ c, scale, frame }) => {
  const color = c.tone === "profit" ? C.accent : c.tone === "loss" ? C.loss : C.text;
  return (
    <div
      style={{
        position: "absolute",
        left: 24 * scale,
        bottom: 24 * scale,
        opacity: fadeIn(frame, 10, 8),
        background: "rgba(38,37,35,0.95)",
        border: `1px solid ${C.lineHard}`,
        borderRadius: 10,
        padding: `${16 * scale}px ${22 * scale}px`,
        maxWidth: "88%",
      }}
    >
      <div style={{ fontFamily: FONT.mono, fontSize: 22 * scale, color: C.muted, letterSpacing: 0.4 }}>{c.label}</div>
      <div style={{ fontFamily: FONT.mono, fontSize: 54 * scale, color, lineHeight: 1.15, fontWeight: 500 }}>{c.value}</div>
      {c.note && <div style={{ fontFamily: FONT.body, fontSize: 22 * scale, color: C.muted, marginTop: 4 }}>{c.note}</div>}
    </div>
  );
};

const SceneView: React.FC<{ scene: Scene; index: number; props: ScreenAdProps; g: Geometry }> = ({ scene, index, props, g }) => {
  const frame = useCurrentFrame();
  const take = props.takes[scene.footage.take];
  if (!take) throw new Error(`take ${scene.footage.take} not passed to ${props.id}`);
  const override = scene.focusByFormat?.[props.format];
  const spec: FootageSpec = override ? { ...scene.footage, focus: override } : scene.footage;
  const capOpacity = index === 0 ? 1 : fadeIn(frame, 0, 6);
  const capShift = index === 0 ? 0 : interpolate(capOpacity, [0, 1], [10, 0]);
  const cap = g.caption;
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
          border: g.radius ? `1px solid ${C.lineHard}` : undefined,
        }}
      >
        <Footage spec={spec} take={take} width={g.panel.w} height={g.panel.h} sceneSec={scene.seconds} pointerScale={g.pointerScale} />
        {scene.callout && <CalloutCard c={scene.callout} scale={g.callout.size} frame={frame} />}
      </div>
      <div
        style={{
          position: "absolute",
          left: cap.x,
          top: cap.y,
          width: cap.w,
          height: cap.h,
          display: "flex",
          alignItems: cap.boxed ? "flex-start" : props.format === "landscape" ? "center" : "flex-end",
          justifyContent: cap.align === "center" ? "center" : "flex-start",
        }}
      >
        <div
          style={{
            opacity: capOpacity,
            transform: `translateY(${capShift}px)`,
            fontFamily: FONT.body,
            fontWeight: cap.boxed ? 700 : 600,
            fontSize: cap.size,
            lineHeight: 1.13,
            letterSpacing: -0.6,
            color: C.text,
            textAlign: cap.align,
            ...(cap.boxed
              ? { background: "rgba(17,17,16,0.9)", padding: "22px 30px", borderRadius: 16, border: `1px solid ${C.lineHard}` }
              : {}),
          }}
        >
          <Emphasis text={scene.caption.text} emphasis={scene.caption.emphasis} />
        </div>
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
          textAlign: cap.boxed ? "center" : "left",
          ...(cap.boxed ? { background: "rgba(17,17,16,0.88)", padding: "10px 16px", borderRadius: 10 } : {}),
        }}
      >
        {scene.footnote ?? props.footnote}
      </div>
    </AbsoluteFill>
  );
};

export const ScreenAd: React.FC<ScreenAdProps> = (props) => {
  const { fps } = useVideoConfig();
  const g = geometry(props.format, props.layout);
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
      {g.brand && endFrom > 0 && (
        <Sequence durationInFrames={endFrom} name="brand">
          <div style={{ position: "absolute", left: g.brand.x, top: g.brand.y }}>
            <Brand size={g.brand.size} />
          </div>
        </Sequence>
      )}
      <Sequence from={endFrom} name="end-card">
        <EndCard {...props.endCard} format={props.format} />
      </Sequence>
    </AbsoluteFill>
  );
};
