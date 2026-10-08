import React from "react";
import { C, FONT } from "../theme";

/** The live site's mark (tradeupbot.app/favicon.svg, Outlay lime crosshair). */
export const Mark: React.FC<{ size: number }> = ({ size }) => (
  <svg width={size} height={size} viewBox="0 0 32 32">
    <g fill="none" stroke={C.accent} strokeWidth={1.8}>
      <circle cx="16" cy="16" r="9" />
      <circle cx="16" cy="16" r="4.5" />
      <line x1="16" y1="4" x2="16" y2="10" strokeLinecap="round" />
      <line x1="16" y1="22" x2="16" y2="28" strokeLinecap="round" />
      <line x1="4" y1="16" x2="10" y2="16" strokeLinecap="round" />
      <line x1="22" y1="16" x2="28" y2="16" strokeLinecap="round" />
    </g>
    <circle cx="16" cy="16" r="1.8" fill={C.accent} />
  </svg>
);

export const Brand: React.FC<{ size?: number }> = ({ size = 34 }) => (
  <div style={{ display: "flex", alignItems: "center", gap: size * 0.35 }}>
    <Mark size={size * 1.15} />
    <span style={{ fontFamily: FONT.body, fontWeight: 600, fontSize: size, color: C.text, letterSpacing: -0.3 }}>
      TradeUpBot
    </span>
  </div>
);
