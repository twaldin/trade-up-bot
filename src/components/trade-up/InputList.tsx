import { useState } from "react";
import { Link } from "react-router-dom";
import type { TradeUp, TradeUpInput } from "../../../shared/types.js";
import { formatDollars, condAbbr, timeAgo, csfloatSearchUrl, listingUrl, listingSource, sourceLabel, sourceColor } from "../../utils/format.js";
import { Badge } from "../../../shared/components/ui/badge.js";
import { toSlug } from "../../../shared/slugs.js";

interface VerifyResult {
  trade_up_id: number;
  inputs: {
    listing_id: string;
    skin_name: string;
    status: "active" | "sold" | "delisted" | "theoretical" | "error";
    current_price?: number;
    original_price: number;
    price_changed?: boolean;
    sold_at?: string;
  }[];
  all_active: boolean;
  any_unavailable: boolean;
  any_price_changed: boolean;
}

interface InputListProps {
  tu: TradeUp;
  verifyResult?: VerifyResult;
  verifying: boolean;
  onVerify: (tuId: number) => void;
  onNavigateSkin?: (skinName: string) => void;
  showListingLinks?: boolean;
  showVerify?: boolean;
  verifyLimit?: { remaining: number; total: number; resetIn: number | null } | null;
  confirmMode?: boolean;
  confirmSelected?: Set<string>;
  onConfirmToggle?: (listingId: string) => void;
  onUnauthLinkClick?: () => void;
  showShare?: boolean;
}

function handleBuffLink(e: React.MouseEvent, input: TradeUpInput) {
  e.preventDefault();
  const url = listingUrl(input.listing_id, input.skin_name, input.condition, input.float_value, input.price_cents, input.source, input.marketplace_id);
  const msg = `Look for float ${input.float_value.toFixed(6)} at ${formatDollars(input.price_cents)}\n\nBuff cannot link to a specific listing. You will be taken to the item page.`;
  if (window.confirm(msg)) {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

function inputHref(input: TradeUpInput, isTheory: boolean): string {
  if (isTheory) return csfloatSearchUrl(input.skin_name, input.condition);
  return listingUrl(input.listing_id, input.skin_name, input.condition, input.float_value, input.price_cents, input.source, input.marketplace_id);
}

function InputCard({ input, onNavigateSkin }: { input: TradeUpInput; onNavigateSkin?: (skinName: string) => void }) {
  const isTheory = input.listing_id.startsWith("theory") || input.listing_id === "theoretical";
  const isBuff = !isTheory && input.source === "buff";
  return (
    <div className="rounded-md border border-border/50 bg-muted/50 px-2 py-1.5 text-[0.75rem]">
      {/* Row 1: Skin name */}
      <div className="flex items-start justify-between gap-1 mb-0.5">
        <a
          href={inputHref(input, isTheory)}
          target="_blank"
          rel="noopener noreferrer"
          className="text-foreground/90 no-underline hover:text-blue-400 leading-tight text-[0.72rem] truncate"
          title={input.skin_name}
          onClick={isBuff ? (e) => handleBuffLink(e, input) : undefined}
        >
          {input.skin_name}
        </a>
        <Link
          to={`/skins/${toSlug(input.skin_name)}`}
          className="text-muted-foreground/50 text-[0.6rem] shrink-0 hover:text-blue-400 transition-colors"
          title={`View ${input.skin_name}`}
          onClick={(e) => e.stopPropagation()}
        >View data</Link>
      </div>
      {/* Row 2: Source + condition + float */}
      <div className="flex items-center gap-1 mb-0.5">
        {!isTheory && input.source && input.source !== "csfloat" && (
          <span className="inline-block px-1 py-0 text-[0.55rem] font-semibold rounded text-white shrink-0" style={{ backgroundColor: sourceColor(input.source) }}>{sourceLabel(input.source)}</span>
        )}
        {isTheory && (
          <Badge variant="outline" className="text-[0.6rem] bg-violet-950 text-violet-400 border-violet-800 py-0 h-4">theory</Badge>
        )}
        <span className="text-muted-foreground text-[0.68rem]">
          {condAbbr(input.condition)}{input.float_value > 0 ? ` ${input.float_value.toFixed(4)}` : ""}
        </span>
      </div>
      {/* Row 3: Price */}
      <div className="text-foreground/80 text-[0.72rem] font-medium">
        {formatDollars(input.price_cents)}
      </div>
    </div>
  );
}

function RegularInputCard({ input, verifyResult, onNavigateSkin, showListingLinks = true, confirmMode = false, confirmChecked = false, onConfirmToggle, onUnauthLinkClick }: {
  input: TradeUpInput;
  verifyResult?: VerifyResult;
  onNavigateSkin?: (skinName: string) => void;
  showListingLinks?: boolean;
  confirmMode?: boolean;
  confirmChecked?: boolean;
  onConfirmToggle?: () => void;
  onUnauthLinkClick?: () => void;
}) {
  const isTheory = input.listing_id.startsWith("theory") || input.listing_id === "theoretical";
  const isBuff = !isTheory && input.source === "buff";
  const inputStatus = verifyResult?.inputs.find(v => v.listing_id === input.listing_id);
  const isSoldOrDelisted = inputStatus?.status === "sold" || inputStatus?.status === "delisted";
  const isMissing = input.missing === true;
  const isClaimedByOther = input.claimed_by_other === true;

  return (
    <div
      className={`rounded-md border px-2.5 py-2 text-[0.78rem] transition-colors ${
        confirmMode ? (confirmChecked ? "border-green-600/50 bg-green-950/20" : "opacity-50 border-border/30 bg-muted/30") :
        isMissing || isClaimedByOther ? "opacity-50 border-red-800/50 bg-red-950/20" :
        isSoldOrDelisted ? "opacity-60 border-red-800/50 bg-red-950/20" : "border-border/50 bg-muted/50"
      } ${confirmMode && !isTheory ? "cursor-pointer" : ""}`}
      onClick={confirmMode && !isTheory && onConfirmToggle ? (e) => { e.stopPropagation(); onConfirmToggle(); } : undefined}
    >
      {/* Confirm mode checkbox */}
      {confirmMode && !isTheory && (
        <div className="flex items-center gap-1.5 mb-1">
          <input type="checkbox" checked={confirmChecked} onChange={onConfirmToggle} onClick={e => e.stopPropagation()} className="accent-green-500 cursor-pointer" />
          <span className="text-[0.65rem] text-muted-foreground">{confirmChecked ? "Purchased" : "Not purchased"}</span>
        </div>
      )}
      {/* Row 1: Skin name + verify status */}
      <div className="flex items-start justify-between gap-1 mb-1">
        {showListingLinks && input.listing_id !== "hidden" ? (
          <a
            href={inputHref(input, isTheory)}
            target="_blank"
            rel="noopener noreferrer"
            className={`no-underline hover:text-blue-400 leading-tight text-[0.75rem] truncate ${isMissing || isSoldOrDelisted ? "line-through text-red-400/70" : "text-foreground/90"}`}
            title={input.skin_name}
            onClick={isBuff ? (e) => handleBuffLink(e, input) : undefined}
          >
            {input.skin_name}
          </a>
        ) : onUnauthLinkClick ? (
          <button
            className={`leading-tight text-[0.75rem] truncate cursor-pointer hover:text-blue-400 transition-colors text-left ${isMissing ? "line-through text-red-400/70" : "text-foreground/90"}`}
            title="Sign in to view listing link"
            onClick={(e) => { e.stopPropagation(); onUnauthLinkClick(); }}
          >
            {input.skin_name}
          </button>
        ) : (
          <span
            className={`leading-tight text-[0.75rem] truncate ${isMissing ? "line-through text-red-400/70" : "text-foreground/90"}`}
            title={input.skin_name}
          >
            {input.skin_name}
          </span>
        )}
        <div className="flex items-center gap-0.5 shrink-0">
          {isMissing && !inputStatus && (
            <Badge variant="outline" className="text-[0.55rem] bg-red-950 text-red-400 border-red-800 font-semibold py-0 h-3.5" title="Listing no longer available">MISSING</Badge>
          )}
          {isClaimedByOther && !isMissing && (
            <Badge variant="outline" className="text-[0.55rem] bg-yellow-950 text-amber-400 border-yellow-800 font-semibold py-0 h-3.5" title="Claimed by another user">CLAIMED</Badge>
          )}
          {inputStatus && inputStatus.status === "active" && <span className="text-green-500 font-bold text-[0.7rem]" title="Still listed">&#10003;</span>}
          {inputStatus && inputStatus.status === "sold" && (
            <Badge variant="outline" className="text-[0.55rem] bg-red-950 text-red-500 border-red-800 font-semibold py-0 h-3.5" title={`Sold ${inputStatus.sold_at ? timeAgo(inputStatus.sold_at) : ""}`}>SOLD</Badge>
          )}
          {inputStatus && inputStatus.status === "delisted" && (
            <Badge variant="outline" className="text-[0.55rem] bg-yellow-950 text-amber-500 border-yellow-800 font-semibold py-0 h-3.5" title="Removed from market">GONE</Badge>
          )}
        </div>
      </div>
      {/* Row 2: Source + condition + float + price */}
      <div className="flex justify-between items-center mb-0.5">
        <div className="flex items-center gap-1">
          {!isTheory && input.source && input.source !== "csfloat" && (
            <span className="inline-block px-1 py-0 text-[0.55rem] font-semibold rounded text-white shrink-0" style={{ backgroundColor: sourceColor(input.source) }}>{sourceLabel(input.source)}</span>
          )}
          {isTheory && (
            <Badge variant="outline" className="text-[0.6rem] bg-violet-950 text-violet-400 border-violet-800 py-0 h-4">theory</Badge>
          )}
          <span className={`text-[0.7rem] ${isMissing || isSoldOrDelisted ? "text-red-400/50 line-through" : "text-muted-foreground"}`}>
            {condAbbr(input.condition)}{input.float_value > 0 ? ` ${input.float_value.toFixed(4)}` : ""}
          </span>
        </div>
        <span className={`text-[0.75rem] ${isMissing || isSoldOrDelisted ? "text-red-400/50 line-through" : "text-foreground/80"}`}>
          {formatDollars(input.price_cents)}
          {inputStatus && inputStatus.price_changed && inputStatus.current_price && (
            <span className="text-amber-500 ml-1 text-[0.68rem] font-semibold" title={`Price changed: was ${formatDollars(inputStatus.original_price)}, now ${formatDollars(inputStatus.current_price)}`}>
              {formatDollars(inputStatus.current_price)}
            </span>
          )}
        </span>
      </div>
      {/* Row 3: View data link */}
      <Link
        to={`/skins/${toSlug(input.skin_name)}`}
        className="mt-0.5 text-[0.65rem] text-muted-foreground/50 hover:text-blue-400 transition-colors"
        title={`View ${input.skin_name}`}
        onClick={(e) => e.stopPropagation()}
      >View data &rarr;</Link>
    </div>
  );
}

function StaircaseStage({ stage, stageIndex, onNavigateSkin }: {
  stage: TradeUpInput[];
  stageIndex: number;
  onNavigateSkin?: (skinName: string) => void;
}) {
  const [open, setOpen] = useState(stageIndex === 0);
  const stageCost = stage.reduce((s, inp) => s + inp.price_cents, 0);
  const stageCollections = [...new Set(stage.map(inp => inp.collection_name))];

  return (
    <details open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary className="text-[0.8rem] font-semibold text-muted-foreground cursor-pointer select-none py-1 pb-1.5 border-b border-border hover:text-foreground transition-colors">
        Trade-Up #{stageIndex + 1} ({stage.length} inputs) &mdash; {formatDollars(stageCost)}
        <span className="ml-1.5 font-normal text-[0.72rem] text-muted-foreground/70">{stageCollections.join(" + ")}</span>
      </summary>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-1.5 pt-1.5">
        {stage.map((input, i) => (
          <InputCard key={i} input={input} onNavigateSkin={onNavigateSkin} />
        ))}
      </div>
    </details>
  );
}

export function InputList({ tu, verifyResult, verifying, onVerify, onNavigateSkin, showListingLinks = true, showVerify = true, verifyLimit, confirmMode = false, confirmSelected, onConfirmToggle, onUnauthLinkClick, showShare = false }: InputListProps) {
  const [shareCopied, setShareCopied] = useState(false);
  return (
    <div>
      <h4 className="text-[0.8rem] text-muted-foreground mb-2 uppercase tracking-wide">
        {tu.type?.startsWith("staircase") && tu.inputs.length > 10
          ? `Inputs (${tu.inputs.length} — ${Math.ceil(tu.inputs.length / 10)} trade-ups)`
          : `Inputs (${tu.inputs.length})`}
        {!tu.is_theoretical && showVerify && (() => {
          const atLimit = verifyLimit && verifyLimit.remaining <= 0;
          const resetMin = verifyLimit?.resetIn ? Math.ceil(verifyLimit.resetIn / 60) : null;
          return (
            <button
              className="ml-2 px-2.5 py-0.5 text-[0.7rem] rounded bg-secondary text-blue-400 border border-border cursor-pointer align-middle hover:bg-accent disabled:opacity-50 disabled:cursor-wait"
              onClick={(e) => { e.stopPropagation(); onVerify(tu.id); }}
              disabled={verifying || !!atLimit}
              title="Check if all inputs are still listed"
            >
              {verifying ? "Checking..." : atLimit ? `Limit (${resetMin}m)` : `Verify${verifyLimit ? ` (${verifyLimit.remaining}/${verifyLimit.total})` : ""}`}
            </button>
          );
        })()}
        {showShare && (
          <button
            className="ml-2 px-2.5 py-0.5 text-[0.7rem] rounded bg-secondary text-foreground/80 border border-border cursor-pointer align-middle hover:bg-accent hover:text-foreground"
            onClick={(e) => {
              e.stopPropagation();
              navigator.clipboard.writeText(`${window.location.origin}/trade-ups/${tu.id}`);
              setShareCopied(true);
              setTimeout(() => setShareCopied(false), 2000);
            }}
            title="Copy shareable link"
          >
            {shareCopied ? "Copied!" : "Share"}
          </button>
        )}
        {!tu.is_theoretical && !showVerify && (
          <span className="ml-2 text-[0.65rem] text-muted-foreground/60 align-middle">Upgrade to Basic to verify listings</span>
        )}
        {verifyResult && (() => {
          const vr = verifyResult;
          const activeCount = vr.inputs.filter(i => i.status === "active").length;
          const unavailCount = vr.inputs.filter(i => i.status === "sold" || i.status === "delisted").length;
          const errorCount = vr.inputs.filter(i => i.status === "error").length;
          if (errorCount === vr.inputs.length) return <span className="ml-2 text-[0.7rem] text-amber-500 font-semibold" title="Rate limited — try again later">Rate limited</span>;
          if (vr.all_active && !vr.any_price_changed) return <span className="ml-2 text-[0.7rem] text-green-500 font-semibold" title="All inputs verified active">{activeCount}/{vr.inputs.length} active</span>;
          if (vr.all_active && vr.any_price_changed) return <span className="ml-2 text-[0.7rem] text-amber-500 font-semibold" title="Some prices changed">{activeCount}/{vr.inputs.length} price changed</span>;
          if (vr.any_unavailable) return <span className="ml-2 text-[0.7rem] text-red-500 font-semibold" title={`${unavailCount} sold/delisted`}>{unavailCount}/{vr.inputs.length} missing</span>;
          if (errorCount > 0) return <span className="ml-2 text-[0.7rem] text-amber-500 font-semibold" title={`${errorCount} couldn't be checked (rate limited)`}>{activeCount}/{vr.inputs.length} checked</span>;
          return null;
        })()}
      </h4>
      {tu.type?.startsWith("staircase") && tu.inputs.length > 10 ? (() => {
        // Group staircase inputs into stage-1 trade-ups (10 inputs each)
        const chunkSize = 10;
        const numStages = Math.ceil(tu.inputs.length / chunkSize);
        const stages: typeof tu.inputs[] = [];
        for (let s = 0; s < numStages; s++) {
          stages.push(tu.inputs.slice(s * chunkSize, (s + 1) * chunkSize));
        }
        return (
          <div className="flex flex-col gap-3">
            {stages.map((stage, si) => (
              <div key={si} className="border border-border rounded-md p-2 bg-white/[0.02]">
                <StaircaseStage stage={stage} stageIndex={si} onNavigateSkin={onNavigateSkin} />
              </div>
            ))}
          </div>
        );
      })() : (
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-1.5">
        {tu.inputs.map((input, i) => (
          <RegularInputCard
            key={i}
            input={input}
            verifyResult={verifyResult}
            onNavigateSkin={onNavigateSkin}
            showListingLinks={showListingLinks}
            confirmMode={confirmMode}
            confirmChecked={confirmSelected?.has(input.listing_id) ?? false}
            onConfirmToggle={onConfirmToggle ? () => onConfirmToggle(input.listing_id) : undefined}
            onUnauthLinkClick={onUnauthLinkClick}
          />
        ))}
      </div>
      )}
    </div>
  );
}
