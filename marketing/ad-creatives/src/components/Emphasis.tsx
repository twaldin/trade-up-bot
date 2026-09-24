import React from "react";
import { C } from "../theme";

/** Renders text with the listed phrases in the site's accent colour. */
export const Emphasis: React.FC<{ text: string; emphasis?: string[]; color?: string }> = ({
  text,
  emphasis = [],
  color = C.accent,
}) => {
  if (emphasis.length === 0) return <>{text}</>;
  const escaped = emphasis.map((e) => e.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const parts = text.split(new RegExp(`(${escaped.join("|")})`, "g"));
  return (
    <>
      {parts.map((p, i) =>
        emphasis.includes(p) ? (
          <span key={i} style={{ color }}>
            {p}
          </span>
        ) : (
          <React.Fragment key={i}>{p}</React.Fragment>
        ),
      )}
    </>
  );
};
