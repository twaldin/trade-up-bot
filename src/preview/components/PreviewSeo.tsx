import type { ReactNode } from "react";

export function PreviewSeo({
  title,
  description,
  canonical,
  jsonLd,
  children,
}: {
  title: string;
  description: string;
  canonical: string;
  jsonLd?: unknown;
  children?: ReactNode;
}) {
  return (
    <>
      <title>{title}</title>
      <meta name="description" content={description} />
      <meta name="robots" content="index, follow" />
      <link rel="canonical" href={canonical} />
      {jsonLd != null && (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      )}
      {children}
    </>
  );
}
