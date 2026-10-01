import React from "react";
import { C } from "../theme";

/** Renders text with the listed phrases in the site's accent colour. */
export const Emphasis: React.FC<{ text: string; emphasis?: string[]; color?: string }> = ({
  text,
  emphasis = [],
  color = C.accent,
}) => {
  const escaped = emphasis.map((e) => e.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const parts = emphasis.length === 0 ? [text] : text.split(new RegExp(`(${escaped.join("|")})`, "g"));
  // One inline box. A flex parent would otherwise make each phrase its own flex item and trim the spaces between them.
  return (
    <span style={{ whiteSpace: "pre-wrap" }}>
      {parts.map((p, i) =>
        emphasis.includes(p) ? (
          <span key={i} style={{ color }}>
            {p}
          </span>
        ) : (
          <React.Fragment key={i}>{p}</React.Fragment>
        ),
      )}
    </span>
  );
};
