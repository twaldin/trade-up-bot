import { useEffect, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { ensureSingleRobots } from "../lib/document-head.js";

export function useRobotsSlot(content: string): boolean {
  const { pathname } = useLocation();
  const [emit] = useState(() => {
    if (typeof document === "undefined") return true;
    return document.querySelector("meta[name='robots']") == null;
  });
  useEffect(() => {
    if (!content) return;
    ensureSingleRobots(content);
  }, [content, pathname]);
  return emit;
}

export function useCanonicalSlot(href: string): boolean {
  const { pathname } = useLocation();
  const [emit] = useState(() => {
    if (typeof document === "undefined") return true;
    return document.querySelector("link[rel='canonical']") == null;
  });
  useEffect(() => {
    if (!href) return;
    let link = document.querySelector("link[rel='canonical']");
    if (!(link instanceof HTMLLinkElement)) {
      const created = document.createElement("link");
      created.rel = "canonical";
      document.head.appendChild(created);
      link = created;
    }
    link.setAttribute("href", href);
  }, [href, pathname]);
  return emit;
}

export function PreviewSeo({
  title,
  description,
  canonical,
  robots = "index, follow",
  jsonLd,
  children,
}: {
  title: string;
  description: string;
  canonical: string;
  robots?: string;
  jsonLd?: unknown;
  children?: ReactNode;
}) {
  const emitCanonical = useCanonicalSlot(canonical);
  const emitRobots = useRobotsSlot(robots);
  return (
    <>
      <title>{title}</title>
      <meta name="description" content={description} />
      {emitRobots && <meta name="robots" content={robots} />}
      {emitCanonical && <link rel="canonical" href={canonical} />}
      {jsonLd != null && (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      )}
      {children}
    </>
  );
}
