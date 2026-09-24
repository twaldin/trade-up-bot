import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { C, FONT, type Format } from "../theme";
import { Mark } from "./Brand";
import { Emphasis } from "./Emphasis";
import { fadeIn } from "./Footage";

export type EndCardProps = {
  seconds: number;
  headline: string;
  emphasis?: string[];
  cta: string;
  url: string;
  offer: string;
  honesty: string;
};

const SCALE: Record<Format, number> = { vertical: 1, portrait: 0.9, square: 0.82, landscape: 0.9 };

export const EndCard: React.FC<EndCardProps & { format: Format }> = ({ headline, emphasis, cta, url, offer, honesty, format }) => {
  const frame = useCurrentFrame();
  const s = SCALE[format];
  const o = fadeIn(frame, 0, 8);
  return (
    <AbsoluteFill style={{ background: C.bg, opacity: o, alignItems: "center", justifyContent: "center" }}>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 34 * s,
          width: format === "landscape" ? 1400 : 920,
          textAlign: "center",
          marginTop: format === "vertical" ? -140 : 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18 * s }}>
          <Mark size={78 * s} />
          <span style={{ fontFamily: FONT.body, fontWeight: 600, fontSize: 58 * s, color: C.text, letterSpacing: -0.8 }}>TradeUpBot</span>
        </div>
        <div style={{ fontFamily: FONT.body, fontWeight: 600, fontSize: 70 * s, lineHeight: 1.1, color: C.text, letterSpacing: -1 }}>
          <Emphasis text={headline} emphasis={emphasis} />
        </div>
        <div
          style={{
            fontFamily: FONT.body,
            fontWeight: 600,
            fontSize: 40 * s,
            color: C.onAccent,
            background: C.accent,
            borderRadius: 8,
            padding: `${18 * s}px ${40 * s}px`,
          }}
        >
          {cta}
        </div>
        <div style={{ fontFamily: FONT.mono, fontSize: 50 * s, color: C.text, letterSpacing: -0.5 }}>{url}</div>
        <div style={{ fontFamily: FONT.body, fontSize: 34 * s, color: C.muted }}>{offer}</div>
        <div
          style={{
            marginTop: 18 * s,
            fontFamily: FONT.mono,
            fontSize: 28 * s,
            color: C.text,
            border: `1px solid ${C.lineHard}`,
            borderRadius: 8,
            padding: `${12 * s}px ${22 * s}px`,
          }}
        >
          {honesty}
        </div>
      </div>
    </AbsoluteFill>
  );
};
