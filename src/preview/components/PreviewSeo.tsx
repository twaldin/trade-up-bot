import { useEffect, useState, type ReactNode } from "react";

export function useRobotsSlot(content: string): boolean {
  const [emit] = useState(() => {
    if (typeof document === "undefined") return true;
    return document.querySelector("meta[name='robots']") == null;
  });
  useEffect(() => {
    if (!content || typeof document === "undefined") return;
    const nodes = [...document.querySelectorAll("meta[name='robots']")].filter(
      (node): node is HTMLMetaElement => node instanceof HTMLMetaElement,
    );
    let meta = nodes[0];
    if (!meta) {
      const created = document.createElement("meta");
      created.setAttribute("name", "robots");
      document.head.appendChild(created);
      meta = created;
    }
    meta.setAttribute("content", content);
    for (const extra of nodes.slice(1)) extra.remove();
  }, [content]);
  return emit;
}

export function useCanonicalSlot(href: string): boolean {
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
  }, [href]);
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
