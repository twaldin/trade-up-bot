import React from "react";
import { AbsoluteFill, Easing, Img, OffthreadVideo, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import type { Take, TakeEvent } from "../facts";

/** A window onto the capture, in the take's CSS pixels: centre + visible width. */
export type Focus = { cx: number; cy: number; w: number };
/** Keyframed focus; `at` is seconds from the start of the scene. */
export type FocusKey = Focus & { at: number };

export type VideoFootage = {
  kind: "video";
  take: string;
  /** Marker name logged by the capture script, or seconds into the take. */
  from: string | number;
  offset?: number;
  rate?: number;
  focus: Focus | FocusKey[];
};

export type ImageFootage = {
  kind: "image";
  take: string;
  shot: string;
  /** Omit to fit the whole screenshot inside the panel. */
  focus?: Focus | FocusKey[];
};

export type FootageSpec = VideoFootage | ImageFootage;

const ease = Easing.inOut(Easing.cubic);

const focusAt = (focus: Focus | FocusKey[], sec: number): Focus => {
  if (!Array.isArray(focus)) return focus;
  const keys = [...focus].sort((a, b) => a.at - b.at);
  if (keys.length === 1 || sec <= keys[0].at) return keys[0];
  const last = keys[keys.length - 1];
  if (sec >= last.at) return last;
  const i = keys.findIndex((k) => k.at > sec);
  const a = keys[i - 1];
  const b = keys[i];
  const p = ease((sec - a.at) / (b.at - a.at));
  return { cx: a.cx + (b.cx - a.cx) * p, cy: a.cy + (b.cy - a.cy) * p, w: a.w + (b.w - a.w) * p };
};

type View = { s: number; left: number; top: number; x0: number; y0: number };

const viewFor = (f: Focus, srcW: number, srcH: number, panelW: number, panelH: number): View => {
  const w = f.w;
  const h = (w * panelH) / panelW;
  const cx = w >= srcW ? srcW / 2 : Math.min(Math.max(f.cx, w / 2), srcW - w / 2);
  const cy = h >= srcH ? srcH / 2 : Math.min(Math.max(f.cy, h / 2), srcH - h / 2);
  const s = panelW / w;
  const x0 = cx - w / 2;
  const y0 = cy - h / 2;
  return { s, left: -x0 * s, top: -y0 * s, x0, y0 };
};

/** Seconds into the take at which a video scene starts (clamped so it never runs off the end). */
export const takeStart = (spec: VideoFootage, take: Take, sceneSec: number): number => {
  const base = typeof spec.from === "number" ? spec.from : take.markers[spec.from];
  if (base === undefined) throw new Error(`marker "${String(spec.from)}" not found in ${take.id}`);
  const start = Math.max(0, base + (spec.offset ?? 0));
  return Math.min(start, Math.max(0, take.duration - sceneSec * (spec.rate ?? 1) - 0.1));
};

const pointerAt = (events: TakeEvent[], t: number): { x: number; y: number } | null => {
  const moves = events.filter((e) => e.type === "move-start" || e.type === "move-end");
  if (moves.length === 0) return null;
  let pos = { x: moves[0].x, y: moves[0].y };
  for (let i = 0; i < moves.length; i++) {
    const e = moves[i];
    if (e.t > t) break;
    if (e.type === "move-start") {
      const end = moves[i + 1];
      if (end && end.type === "move-end" && t < end.t) {
        const p = ease((t - e.t) / Math.max(0.001, end.t - e.t));
        return { x: e.x + (end.x - e.x) * p, y: e.y + (end.y - e.y) * p };
      }
    }
    pos = { x: e.x, y: e.y };
  }
  return pos;
};

const Cursor: React.FC<{ size: number }> = ({ size }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" style={{ filter: "drop-shadow(0 2px 3px rgba(0,0,0,.6))" }}>
    <path d="M4 2 L4 19 L8.5 14.8 L11.4 21.4 L14.2 20.2 L11.3 13.7 L17.6 13.4 Z" fill="#fff" stroke="#000" strokeWidth={1.2} strokeLinejoin="round" />
  </svg>
);

const Ripple: React.FC<{ x: number; y: number; age: number; size: number }> = ({ x, y, age, size }) => {
  const p = Math.min(1, age / 0.55);
  const r = size * (0.55 + 0.6 * p);
  return (
    <div
      style={{
        position: "absolute",
        left: x - r,
        top: y - r,
        width: r * 2,
        height: r * 2,
        borderRadius: "50%",
        background: `rgba(238,236,231,${0.28 * (1 - p)})`,
        border: `3px solid rgba(238,236,231,${0.75 * (1 - p)})`,
      }}
    />
  );
};

export const Footage: React.FC<{
  spec: FootageSpec;
  take: Take;
  width: number;
  height: number;
  sceneSec: number;
  pointerScale?: number;
}> = ({ spec, take, width, height, sceneSec, pointerScale = 1 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const sec = frame / fps;

  if (spec.kind === "image") {
    const shot = take.screenshots[spec.shot];
    if (!shot) throw new Error(`screenshot "${spec.shot}" missing in ${take.id}`);
    const fit = Math.min(width / shot.cssWidth, height / shot.cssHeight);
    const f: Focus = spec.focus ? focusAt(spec.focus, sec) : { cx: shot.cssWidth / 2, cy: shot.cssHeight / 2, w: width / fit };
    const v = viewFor(f, shot.cssWidth, shot.cssHeight, width, height);
    const imgW = shot.cssWidth * v.s;
    const imgH = shot.cssHeight * v.s;
    const left = f.w >= shot.cssWidth ? (width - imgW) / 2 : v.left;
    const top = (f.w * height) / width >= shot.cssHeight ? (height - imgH) / 2 : v.top;
    return (
      <AbsoluteFill style={{ overflow: "hidden" }}>
        <Img src={staticFile(`captures/${shot.file}`)} style={{ position: "absolute", left, top, width: imgW, height: imgH }} />
      </AbsoluteFill>
    );
  }

  const rate = spec.rate ?? 1;
  const t0 = takeStart(spec, take, sceneSec);
  const tt = t0 + sec * rate;
  const f = focusAt(spec.focus, sec);
  const v = viewFor(f, take.viewport.width, take.viewport.height, width, height);
  const toPanel = (x: number, y: number) => ({ x: (x - v.x0) * v.s, y: (y - v.y0) * v.s });
  const pointer = take.device === "desktop" ? pointerAt(take.events, tt) : null;
  const pulses = take.events.filter((e) => (e.type === "click" || e.type === "tap") && tt >= e.t && tt - e.t < 0.55);
  const size = 40 * pointerScale;

  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <OffthreadVideo
        src={staticFile(`captures/${take.file}`)}
        trimBefore={Math.round(t0 * fps)}
        playbackRate={rate}
        muted
        style={{
          position: "absolute",
          left: v.left,
          top: v.top,
          width: take.viewport.width * v.s,
          height: take.viewport.height * v.s,
          maxWidth: "none",
        }}
      />
      {pulses.map((e, i) => {
        const p = toPanel(e.x, e.y);
        return <Ripple key={i} x={p.x} y={p.y} age={tt - e.t} size={e.type === "tap" ? size * 1.1 : size * 0.7} />;
      })}
      {pointer &&
        (() => {
          const p = toPanel(pointer.x, pointer.y);
          return (
            <div style={{ position: "absolute", left: p.x - size * 0.16, top: p.y - size * 0.08 }}>
              <Cursor size={size} />
            </div>
          );
        })()}
    </AbsoluteFill>
  );
};

export const fadeIn = (frame: number, start: number, len = 8) =>
  interpolate(frame, [start, start + len], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
