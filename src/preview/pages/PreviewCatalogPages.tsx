import { Suspense, useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { collectionToSlug } from "../../../shared/slugs.js";
import { CollectionListViewer } from "../../components/CollectionListViewer.js";
import { CollectionViewer } from "../../components/CollectionViewer.js";
import { DataViewer } from "../../components/DataViewer.js";
import { ListingSniperPage } from "../../pages/ListingSniperPage.js";
import MyTradeUpsPage from "../../pages/MyTradeUpsPage.js";
import { SkinPage } from "../../pages/SkinPage.js";

function Loading() {
  return <div className="text-center py-8 text-muted-foreground animate-pulse">Loading</div>;
}

export function PreviewMyTradeUpsPage() {
  return (
    <div className="pv-embed">
      <MyTradeUpsPage />
    </div>
  );
}

export function PreviewListingSniperPage() {
  return (
    <div className="pv-embed">
      <ListingSniperPage />
    </div>
  );
}

export function PreviewSkinsPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const initialSearch = searchParams.get("search") || undefined;
  return (
    <div className="pv-embed">
      <DataViewer
        key={initialSearch || "data"}
        onNavigateCollection={(name) => navigate(`/preview/collections/${collectionToSlug(name)}`)}
        initialSearch={initialSearch}
      />
    </div>
  );
}

export function PreviewSkinDetailPage() {
  return (
    <div className="pv-embed">
      <Suspense fallback={<Loading />}>
        <SkinPage />
      </Suspense>
    </div>
  );
}

export function PreviewCollectionsPage() {
  const navigate = useNavigate();
  return (
    <div className="pv-embed">
      <CollectionListViewer
        onSelectCollection={(name) => navigate(`/preview/collections/${collectionToSlug(name)}`)}
      />
    </div>
  );
}

export function PreviewCollectionPage() {
  const { name } = useParams<{ name: string }>();
  const navigate = useNavigate();
  const [collectionName, setCollectionName] = useState<string | null>(null);

  useEffect(() => {
    if (!name) return;
    fetch(`/api/collection-by-slug/${encodeURIComponent(name)}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.name) setCollectionName(data.name);
        else setCollectionName(decodeURIComponent(name));
      })
      .catch(() => setCollectionName(decodeURIComponent(name)));
  }, [name]);

  if (!collectionName) return <Loading />;

  return (
    <div className="pv-embed">
      <CollectionViewer
        collectionName={collectionName}
        onBack={() => navigate("/preview/collections")}
        onNavigateCollection={(n) => navigate(`/preview/collections/${collectionToSlug(n)}`)}
      />
    </div>
  );
}
