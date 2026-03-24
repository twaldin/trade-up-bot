import { useState, useEffect, lazy, Suspense } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { collectionToSlug } from "../../shared/slugs.js";

const DataViewer = lazy(() => import("../components/DataViewer.js").then(m => ({ default: m.DataViewer })));

export function SkinPage() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const [skinName, setSkinName] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!slug) return;
    fetch(`/api/skin-by-slug/${encodeURIComponent(slug)}`)
      .then(r => {
        if (!r.ok) { setNotFound(true); return null; }
        return r.json();
      })
      .then(data => { if (data?.name) setSkinName(data.name); })
      .catch(() => setNotFound(true));
  }, [slug]);

  if (notFound) {
    return <div className="text-center py-12 text-muted-foreground">Skin not found</div>;
  }

  if (!skinName) {
    return <div className="text-center py-8 text-muted-foreground animate-pulse">Loading</div>;
  }

  return (
    <>
      <Helmet>
        <title>{skinName} Price & Float Data — CS2 | TradeUpBot</title>
        <meta name="description" content={`${skinName} CS2 prices and float data across CSFloat, DMarket, and Skinport.`} />
        <link rel="canonical" href={`https://tradeupbot.app/skins/${slug}`} />
        <meta property="og:title" content={`${skinName} Price & Float Data — CS2 | TradeUpBot`} />
        <meta property="og:description" content={`${skinName} CS2 prices and float data across CSFloat, DMarket, and Skinport.`} />
        <meta property="og:url" content={`https://tradeupbot.app/skins/${slug}`} />
        <meta property="og:type" content="product" />
      </Helmet>
      <Suspense fallback={<div className="text-center py-8 text-muted-foreground animate-pulse">Loading</div>}>
        <DataViewer
          initialSelectedSkin={skinName}
          onNavigateCollection={(name) => navigate(`/collections/${collectionToSlug(name)}`)}
        />
      </Suspense>
    </>
  );
}
