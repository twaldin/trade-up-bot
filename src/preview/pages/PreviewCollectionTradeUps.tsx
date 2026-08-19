import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { PreviewSeo } from "../components/PreviewSeo.js";
import { previewCollectionHref } from "../lib/board.js";
import { PreviewBoard, usePreviewTradeUps } from "./PreviewBoard.js";

function displayNameFor(name: string): string {
  return name.replace(/^The\s+/i, "").replace(/\s+Collection$/i, "");
}

export function PreviewCollectionTradeUps() {
  const { slug = "" } = useParams<{ slug: string }>();
  const [title, setTitle] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let live = true;
    fetch(`/api/collection-by-slug/${encodeURIComponent(slug)}`, { credentials: "include" })
      .then((res) => res.ok ? res.json() : null)
      .then((data: { name?: string } | null) => {
        if (!live) return;
        if (data?.name) {
          setTitle(data.name);
          setMissing(false);
        } else {
          setMissing(true);
        }
      })
      .catch(() => { if (live) setMissing(true); });
    return () => { live = false; };
  }, [slug]);

  const board = usePreviewTradeUps({ collection: title ?? undefined, perPage: 6 });
  const display = title ? displayNameFor(title) : slug;
  const pageTitle = `Best ${display} Trade-Ups — Profitable CS2 Contracts | TradeUpBot`;
  const description = `${board.tradeUps.length} profitable trade-ups from the ${display} collection. Real listings from CSFloat, DMarket, Skinport.`;

  return (
    <div className="preview-page">
      <PreviewSeo
        title={pageTitle}
        description={description}
        canonical={`https://tradeupbot.app/trade-ups/collection/${slug}`}
      />
      <header className="preview-page__head">
        <div>
          <nav className="preview-crumb" aria-label="Breadcrumb">
            <Link className="preview-link" to="/trade-ups">Trade-Ups</Link>
            <span aria-hidden>/</span>
            {title && (
              <>
                <Link className="preview-link" to={previewCollectionHref(title)}>{display} Collection</Link>
                <span aria-hidden>/</span>
              </>
            )}
            <span>Trade-Ups</span>
          </nav>
          <h1>{display} Trade-Ups</h1>
          <p>Ranked the same way as the board, filtered to this collection.</p>
        </div>
        <div className="preview-page__meta"><span>{board.tradeUps.length} trade-ups</span></div>
      </header>

      {missing && (
        <section className="preview-panel">
          <p className="preview-note">Collection not found.</p>
          <Link className="preview-btn" to="/collections">Browse collections</Link>
        </section>
      )}

      {title && (
        <PreviewBoard
          tradeUps={board.tradeUps}
          loading={board.loading}
          isFree={board.isFree}
          expandedId={board.expandedId}
          onExpand={board.onExpand}
          query={board.query}
          onQuery={board.onQuery}
          loadMore={board.loadMore}
          exhausted={board.exhausted}
          throttle={board.throttle}
          collection={title}
          heading={`${display} Trade-Ups`}
          lede={`Profitable trade-ups using skins from the ${display} collection.`}
          embed
        />
      )}
    </div>
  );
}
