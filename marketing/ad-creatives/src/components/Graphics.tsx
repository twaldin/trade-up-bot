import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { C, FONT } from "../theme";

const STOPS = [0, 0.07, 0.15, 0.38, 0.45, 1];
/** Close ticks (0.00/0.07/0.15 and 0.38/0.45) sit on alternating rows so 28px labels do not collide. */
const LABEL_ROW = [0, 1, 0, 1, 0, 1];

/** Wear boundaries as labelled on the live skin chart. Not a price series. */
export const RangeBar: React.FC<{ stopAt: number; height?: number; instant?: boolean }> = ({ stopAt, height = 160, instant }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = instant ? stopAt : interpolate(frame, [0, Math.round(0.9 * fps)], [0.55, stopAt], { extrapolateRight: "clamp" });
  return (
    <div data-visual="range" style={{ position: "relative", height, minHeight: height, flexShrink: 0, margin: "0 64px" }}>
      <div style={{ position: "absolute", left: 0, right: 0, top: 28, height: 8, borderRadius: 4, background: C.lineHard }} />
      {STOPS.map((s) => (
        <div key={s} style={{ position: "absolute", left: `${s * 100}%`, top: 18, width: 2, height: 28, background: C.muted, transform: "translateX(-1px)" }} />
      ))}
      <div
        style={{
          position: "absolute",
          left: `${p * 100}%`,
          top: 8,
          width: 16,
          height: 48,
          borderRadius: 3,
          background: C.accent,
          transform: "translateX(-8px)",
        }}
      />
      {STOPS.map((s, i) => (
        <span
          key={s}
          style={{
            position: "absolute",
            left: `${s * 100}%`,
            top: 62 + LABEL_ROW[i] * 46,
            transform: "translateX(-50%)",
            fontFamily: FONT.mono,
            fontSize: 28,
            color: C.muted,
            whiteSpace: "nowrap",
          }}
        >
          {s.toFixed(2)}
        </span>
      ))}
    </div>
  );
};

export const BigRows: React.FC<{ rows: { k: string; v: string }[]; size?: number; instant?: boolean }> = ({ rows, size = 80, instant }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const o = instant
    ? 1
    : interpolate(frame, [Math.round(0.45 * fps), Math.round(0.7 * fps)], [0, 1], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      });
  return (
    <div style={{ opacity: o, display: "flex", flexDirection: "column", gap: 8 }}>
      {rows.map((r) => (
        <div key={r.k} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 24 }}>
          <span style={{ fontFamily: FONT.mono, fontSize: size * 0.45, color: C.muted }}>{r.k}</span>
          <span style={{ fontFamily: FONT.mono, fontSize: size, color: C.text, letterSpacing: -1 }}>{r.v}</span>
        </div>
      ))}
    </div>
  );
};
