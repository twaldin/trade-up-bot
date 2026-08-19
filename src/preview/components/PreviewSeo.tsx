import type { ReactNode } from "react";

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
  return (
    <>
      <title>{title}</title>
      <meta name="description" content={description} />
      <meta name="robots" content={robots} />
      <link rel="canonical" href={canonical} />
      {jsonLd != null && (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      )}
      {children}
    </>
  );
}
