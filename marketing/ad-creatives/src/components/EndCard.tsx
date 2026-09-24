import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { C, DIMENSIONS, FONT, safeBand, type Format } from "../theme";
import { Mark } from "./Brand";
import { Emphasis } from "./Emphasis";
import { fadeIn } from "./Footage";
import { DELAY, VALVE } from "../live-read";

export type EndCardProps = {
  seconds: number;
  headline: string;
  emphasis?: string[];
  cta: string;
  url: string;
  offer: string;
  honesty: string;
  example: string;
};

const SCALE: Record<Format, number> = { vertical: 0.72, portrait: 0.78, square: 0.7, landscape: 0.9 };

export const EndCard: React.FC<EndCardProps & { format: Format }> = ({
  headline,
  emphasis,
  cta,
  url,
  offer,
  honesty,
  example,
  format,
}) => {
  const frame = useCurrentFrame();
  const s = SCALE[format];
  const o = fadeIn(frame, 0, 8);
  const band = safeBand(DIMENSIONS[format].height);
  return (
    <AbsoluteFill style={{ background: C.bg, opacity: o }}>
      <div
        style={{
          position: "absolute",
          left: 72,
          right: 72,
          top: band.top + 8,
          bottom: DIMENSIONS[format].height - band.bottom,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: format === "vertical" ? 12 : 8,
          overflow: "hidden",
          justifyContent: "flex-start",
          textAlign: "center",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14 * s }}>
          <Mark size={56 * s} />
          <span style={{ fontFamily: FONT.body, fontWeight: 600, fontSize: 42 * s, color: C.text }}>TradeUpBot</span>
        </div>
        <div style={{ fontFamily: FONT.body, fontWeight: 600, fontSize: 48 * s, lineHeight: 1.12, color: C.text }}>
          <Emphasis text={headline} emphasis={emphasis} />
        </div>
        <div
          style={{
            fontFamily: FONT.body,
            fontWeight: 600,
            fontSize: 32 * s,
            color: C.onAccent,
            background: C.accent,
            borderRadius: 8,
            padding: `${12 * s}px ${28 * s}px`,
          }}
        >
          {cta}
        </div>
        <div style={{ fontFamily: FONT.mono, fontSize: 36 * s, color: C.text }}>{url}</div>
        <div style={{ fontFamily: FONT.body, fontSize: 26 * s, color: C.muted }}>{offer}</div>
        <div style={{ fontFamily: FONT.mono, fontSize: 28, color: C.text, border: `1px solid ${C.lineHard}`, borderRadius: 8, padding: "10px 16px" }}>
          {honesty}
        </div>
        <div style={{ fontFamily: FONT.mono, fontSize: 28, color: C.text }}>{DELAY}</div>
        <div style={{ fontFamily: FONT.body, fontSize: 28, color: C.text }}>{VALVE}</div>
        <div style={{ fontFamily: FONT.body, fontSize: 28, color: C.text, lineHeight: 1.3 }}>{example}</div>
      </div>
    </AbsoluteFill>
  );
};
