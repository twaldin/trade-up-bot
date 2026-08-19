import { useCallback, useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import type { TradeUp, TradeUpInput } from "../../../shared/types.js";
import type { SnapshotOutcome, UserTradeUp, UserTradeUpStats } from "../../../shared/my-trade-ups-types.js";
import { authHref } from "../../lib/ref.js";
import { formatDollars } from "../../utils/format.js";
import { PreviewTable, type Column } from "../components/PreviewTable.js";
import { hydrateOutcomesIfNeeded } from "../lib/skin-images.js";
import {
  ACCOUNT_EMPTY,
  ACCOUNT_TABS,
  MARKETPLACE_LABELS,
  MARKETPLACE_OPTIONS,
  MY_TRADE_UPS_API,
  claimTimerLabel,
  confirmPurchaseCopy,
  expiryByTradeUpId,
  formatShortDate,
  parseSalePriceCents,
  realListingIds,
  salePreview,
  signClass,
  tradeHoldStatus,
  type ActiveClaimRow,
  type VerifyPayload,
} from "../lib/my-trade-ups.js";
import { TradeUpCard, boardFaceFor, warmBoardFaces } from "./PreviewBoard.js";

interface AuthUser {
  steam_id: string;
  display_name: string;
  avatar_url: string;
  tier: string;
  is_admin: boolean;
}

function signedDollars(cents: number): string {
  return cents > 0 ? `+${formatDollars(cents)}` : formatDollars(cents);
}

async function hydrateInputsIfNeeded(tu: TradeUp): Promise<TradeUp> {
  if (tu.inputs.length > 0) return tu;
  try {
    const res = await fetch(`/api/trade-up/${tu.id}/inputs`, { credentials: "include" });
    if (!res.ok) return tu;
    const data = await res.json() as { inputs?: TradeUpInput[] };
    return { ...tu, inputs: data.inputs ?? [] };
  } catch {
    return tu;
  }
}

function skinNames(rows: TradeUp[]): string[] {
  return rows.flatMap((tu) => [
    ...tu.inputs.map((row) => row.skin_name),
    ...tu.outcomes.map((outcome) => outcome.skin_name),
  ]);
}

function Face({ name }: { name: string }) {
  const src = boardFaceFor(name);
  if (src) {
    return (
      <img
        src={src}
        alt=""
        onError={(event) => {
          event.currentTarget.style.visibility = "hidden";
        }}
      />
    );
  }
  return <div className="preview-skin__ph" />;
}

function ClaimTimer({ expiresAt }: { expiresAt: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 15000);
    return () => window.clearInterval(id);
  }, [expiresAt]);
  const tick = claimTimerLabel(expiresAt, now);
  return <span className={`preview-timer ${tick.expired || tick.minutes <= 5 ? "is-minus" : ""}`}>{tick.label}</span>;
}

function FaceStack({ names }: { names: string[] }) {
  const shown = names.filter(Boolean).slice(0, 4);
  if (shown.length === 0) return <span className="preview-note">—</span>;
  return (
    <span className="preview-faces">
      {shown.map((name) => (
        <span key={name} className="preview-faces__art" title={name}>
          <Face name={name} />
        </span>
      ))}
    </span>
  );
}

export function PreviewAccount() {
  const location = useLocation();
  const [user, setUser] = useState<AuthUser | null | undefined>(undefined);
  const [activeTab, setActiveTab] = useState<(typeof ACCOUNT_TABS)[number]["key"]>("claims");
  const [claimTradeUps, setClaimTradeUps] = useState<TradeUp[]>([]);
  const [entries, setEntries] = useState<UserTradeUp[]>([]);
  const [stats, setStats] = useState<UserTradeUpStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [faceTick, setFaceTick] = useState(0);

  const [executingId, setExecutingId] = useState<number | null>(null);
  const [selectedOutcome, setSelectedOutcome] = useState<number | null>(null);
  const [sellingId, setSellingId] = useState<number | null>(null);
  const [salePrice, setSalePrice] = useState("");
  const [saleMarketplace, setSaleMarketplace] = useState("csfloat");
  const [actionError, setActionError] = useState<string | null>(null);
  const [claimExpiries, setClaimExpiries] = useState<Map<number, string>>(new Map());
  const [claimedIds, setClaimedIds] = useState<Set<number>>(new Set());
  const [confirmModeId, setConfirmModeId] = useState<number | null>(null);
  const [confirmSelected, setConfirmSelected] = useState<Set<string>>(new Set());
  const [verifyingId, setVerifyingId] = useState<number | null>(null);
  const [verifyById, setVerifyById] = useState<Map<number, VerifyPayload>>(new Map());

  const fetchData = useCallback(async (signal?: AbortSignal) => {
    if (!user) return;
    setLoading(true);
    setNote(null);
    try {
      const mainReq = activeTab === "claims"
        ? fetch(MY_TRADE_UPS_API.claims, { credentials: "include", signal })
        : fetch(activeTab === "purchased" ? MY_TRADE_UPS_API.purchased : MY_TRADE_UPS_API.history, { credentials: "include", signal });
      const statsReq = fetch(MY_TRADE_UPS_API.stats, { credentials: "include", signal })
        .then((res) => {
          if (res.status === 401 || res.status === 403) return null;
          return res.ok ? res.json() : null;
        })
        .then((data: UserTradeUpStats | null) => {
          if (!signal?.aborted && data) setStats(data);
        })
        .catch(() => undefined);

      const res = await mainReq;
      if (signal?.aborted) return;
      if (res.status === 401 || res.status === 403) {
        setNote("Claims need a Pro account. Pricing stays on the production route.");
        setClaimTradeUps([]);
        setEntries([]);
        return;
      }
      if (!res.ok) {
        setNote("Could not load trade-ups.");
        return;
      }
      const data = await res.json() as { trade_ups?: TradeUp[] | UserTradeUp[] };
      if (signal?.aborted) return;
      if (activeTab === "claims") {
        const rows = (data.trade_ups ?? []) as TradeUp[];
        const hydrated = await Promise.all(rows.map(async (tu) => (
          hydrateInputsIfNeeded(await hydrateOutcomesIfNeeded(tu))
        )));
        if (signal?.aborted) return;
        setClaimTradeUps(hydrated);
        const mine = new Set<number>();
        const fromRows = new Map<number, string>();
        for (const tu of hydrated) {
          if (tu.claimed_by_me || tu.claim_expires_at) mine.add(tu.id);
          if (tu.claim_expires_at) fromRows.set(tu.id, tu.claim_expires_at);
        }
        try {
          const claimsRes = await fetch(MY_TRADE_UPS_API.activeClaims, { credentials: "include", signal });
          if (claimsRes.ok) {
            const claimsData = await claimsRes.json() as { claims?: ActiveClaimRow[] };
            const fromApi = expiryByTradeUpId(claimsData.claims ?? []);
            for (const [id, exp] of fromApi) {
              fromRows.set(id, exp);
              mine.add(id);
            }
          }
        } catch {
          // timer is best-effort; the my_claims list still paints
        }
        if (!signal?.aborted) {
          setClaimedIds(mine);
          setClaimExpiries(fromRows);
        }
        void warmBoardFaces(skinNames(hydrated)).then(() => {
          if (!signal?.aborted) setFaceTick((tick) => tick + 1);
        });
      } else {
        const rows = (data.trade_ups ?? []) as UserTradeUp[];
        setEntries(rows);
        const names = rows.flatMap((row) => [
          ...row.snapshot_inputs.map((inp) => inp.skin_name),
          ...row.snapshot_outcomes.map((out) => out.skin_name),
          row.outcome_skin_name ?? "",
        ]);
        void warmBoardFaces(names).then(() => {
          if (!signal?.aborted) setFaceTick((tick) => tick + 1);
        });
      }
      await statsReq;
    } catch (error) {
      if (signal?.aborted) return;
      console.error("Failed to fetch my trade-ups", error);
      setNote("Could not load trade-ups.");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [activeTab, user]);

  useEffect(() => {
    fetch("/api/auth/me", { credentials: "include" })
      .then((res) => res.ok ? res.json() : null)
      .then((data: AuthUser | null) => setUser(data?.steam_id ? data : null))
      .catch(() => setUser(null));
  }, []);

  useEffect(() => {
    if (!user) return;
    const controller = new AbortController();
    void fetchData(controller.signal);
    return () => controller.abort();
  }, [fetchData, user]);

  const readError = async (res: Response, fallback: string) => {
    try {
      const data = await res.json() as { error?: string };
      return data.error || fallback;
    } catch {
      return fallback;
    }
  };

  async function handleClaim(id: number) {
    setActionError(null);
    const res = await fetch(MY_TRADE_UPS_API.claim(id), { method: "POST", credentials: "include" });
    const data = await res.json() as { error?: string; claim?: { expires_at?: string } };
    if (!res.ok) {
      setActionError(data.error || "Failed to claim");
      return;
    }
    setClaimedIds((prev) => new Set(prev).add(id));
    if (data.claim?.expires_at) {
      setClaimExpiries((prev) => new Map(prev).set(id, data.claim!.expires_at!));
    }
    void fetchData();
  }

  async function handleVerify(id: number) {
    setActionError(null);
    setVerifyingId(id);
    try {
      const res = await fetch(MY_TRADE_UPS_API.verify(id), { method: "POST", credentials: "include" });
      const data = await res.json() as VerifyPayload;
      if (!res.ok) {
        setActionError(data.error || "Failed to verify");
        return;
      }
      setVerifyById((prev) => new Map(prev).set(id, data));
      if (data.updated_trade_up) {
        setClaimTradeUps((prev) => prev.map((tu) => (
          tu.id === id
            ? {
              ...tu,
              total_cost_cents: data.updated_trade_up!.total_cost_cents,
              profit_cents: data.updated_trade_up!.profit_cents,
              roi_percentage: data.updated_trade_up!.roi_percentage,
              expected_value_cents: data.updated_trade_up!.expected_value_cents ?? tu.expected_value_cents,
            }
            : tu
        )));
      }
    } catch {
      setActionError("Failed to verify");
    } finally {
      setVerifyingId(null);
    }
  }

  function beginConfirm(tu: TradeUp) {
    setConfirmModeId(tu.id);
    setConfirmSelected(new Set(realListingIds(tu)));
    setExpandedId(tu.id);
    setActionError(null);
  }

  function toggleConfirmListing(listingId: string) {
    setConfirmSelected((prev) => {
      const next = new Set(prev);
      if (next.has(listingId)) next.delete(listingId);
      else next.add(listingId);
      return next;
    });
  }

  async function handleConfirmPurchased(tu: TradeUp) {
    const listingIds = confirmModeId === tu.id ? [...confirmSelected] : realListingIds(tu);
    const total = realListingIds(tu).length;
    if (listingIds.length === 0) {
      setActionError("Select at least one listing");
      return;
    }
    if (!window.confirm(confirmPurchaseCopy(listingIds.length, total))) return;
    setActionError(null);
    const res = await fetch(MY_TRADE_UPS_API.confirm(tu.id), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ listing_ids: listingIds }),
    });
    if (!res.ok) {
      setActionError(await readError(res, "Failed to confirm"));
      return;
    }
    setConfirmModeId(null);
    setConfirmSelected(new Set());
    setClaimedIds((prev) => {
      const next = new Set(prev);
      next.delete(tu.id);
      return next;
    });
    void fetchData();
  }

  async function handleUnclaim(id: number) {
    if (!window.confirm("Release this claim? The listings will become available to other users again.")) return;
    setActionError(null);
    const res = await fetch(MY_TRADE_UPS_API.unclaim(id), { method: "DELETE", credentials: "include" });
    if (!res.ok) {
      setActionError(await readError(res, "Failed to release"));
      return;
    }
    if (expandedId === id) setExpandedId(null);
    if (confirmModeId === id) {
      setConfirmModeId(null);
      setConfirmSelected(new Set());
    }
    setClaimedIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    void fetchData();
  }

  async function handleExecute(id: number) {
    if (selectedOutcome === null) return;
    setActionError(null);
    const res = await fetch(MY_TRADE_UPS_API.execute(id), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ outcome_index: selectedOutcome }),
    });
    if (!res.ok) {
      setActionError(await readError(res, "Failed to execute"));
      return;
    }
    setExecutingId(null);
    setSelectedOutcome(null);
    void fetchData();
  }

  async function handleSell(id: number) {
    const priceCents = parseSalePriceCents(salePrice);
    if (priceCents === null) {
      setActionError("Enter a valid sale price");
      return;
    }
    setActionError(null);
    const res = await fetch(MY_TRADE_UPS_API.sell(id), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ price_cents: priceCents, marketplace: saleMarketplace }),
    });
    if (!res.ok) {
      setActionError(await readError(res, "Failed to record sale"));
      return;
    }
    setSellingId(null);
    setSalePrice("");
    setSaleMarketplace("csfloat");
    void fetchData();
  }

  async function handleRemove(id: number) {
    if (!window.confirm("Remove this trade-up? This cannot be undone.")) return;
    setActionError(null);
    const res = await fetch(MY_TRADE_UPS_API.remove(id), { method: "DELETE", credentials: "include" });
    if (!res.ok) {
      setActionError(await readError(res, "Failed to remove"));
      return;
    }
    if (executingId === id) setExecutingId(null);
    if (sellingId === id) setSellingId(null);
    void fetchData();
  }

  const executing = executingId === null ? null : entries.find((row) => row.id === executingId) ?? null;
  const selling = sellingId === null ? null : entries.find((row) => row.id === sellingId) ?? null;
  const saleCents = parseSalePriceCents(salePrice);
  const saleGuess = selling && saleCents !== null ? salePreview(selling.total_cost_cents, saleCents) : null;

  const columns: Column<UserTradeUp>[] = [
    {
      key: "skins",
      label: "Skins",
      sortValue: (row) => row.snapshot_inputs[0]?.skin_name ?? row.outcome_skin_name ?? "",
      render: (row) => {
        const names = [
          ...row.snapshot_inputs.map((inp) => inp.skin_name),
          row.outcome_skin_name ?? row.snapshot_outcomes[0]?.skin_name ?? "",
        ];
        return (
          <span className="preview-skinline">
            <FaceStack names={[...new Set(names)]} />
            <span>{row.outcome_skin_name ?? row.snapshot_outcomes[0]?.skin_name ?? row.snapshot_inputs[0]?.skin_name ?? "Trade-up"}</span>
          </span>
        );
      },
    },
    {
      key: "status",
      label: "Status",
      sortValue: (row) => row.status,
      render: (row) => <span className="preview-chip">{row.status}</span>,
    },
    {
      key: "cost",
      label: "Cost",
      align: "end",
      sortValue: (row) => row.total_cost_cents,
      render: (row) => <span className="o-mono">{formatDollars(row.total_cost_cents)}</span>,
    },
    {
      key: "sold",
      label: "Sold $",
      align: "end",
      sortValue: (row) => row.sold_price_cents ?? -1,
      render: (row) => (
        <span className="o-mono">{row.sold_price_cents == null ? "—" : formatDollars(row.sold_price_cents)}</span>
      ),
    },
    {
      key: "pl",
      label: "P/L",
      align: "end",
      sortValue: (row) => row.actual_profit_cents ?? (row.expected_value_cents - row.total_cost_cents),
      render: (row) => {
        const cents = row.actual_profit_cents ?? (row.expected_value_cents - row.total_cost_cents);
        return <span className={`o-mono ${signClass(cents)}`}>{signedDollars(cents)}</span>;
      },
    },
    {
      key: "market",
      label: "Market",
      sortValue: (row) => row.sold_marketplace ?? "",
      render: (row) => (
        <span>{row.sold_marketplace ? (MARKETPLACE_LABELS[row.sold_marketplace] ?? row.sold_marketplace) : "—"}</span>
      ),
    },
    {
      key: "dates",
      label: "Dates",
      sortValue: (row) => row.sold_at ?? row.executed_at ?? row.purchased_at,
      render: (row) => (
        <span className="preview-dates">
          <em>Bought {formatShortDate(row.purchased_at)}</em>
          {row.executed_at && <em>Done {formatShortDate(row.executed_at)}</em>}
          {row.sold_at && <em>Sold {formatShortDate(row.sold_at)}</em>}
          {row.status === "purchased" && <em>{tradeHoldStatus(row.purchased_at).label}</em>}
        </span>
      ),
    },
    {
      key: "actions",
      label: "Actions",
      align: "end",
      render: (row) => (
        <span className="preview-rowacts">
          {row.status === "purchased" && (
            <button
              type="button"
              className="preview-btn preview-btn--quiet"
              onClick={() => { setExecutingId(row.id); setSelectedOutcome(null); setSellingId(null); setActionError(null); }}
            >
              Mark Complete
            </button>
          )}
          {row.status === "executed" && (
            <button
              type="button"
              className="preview-btn preview-btn--quiet"
              onClick={() => { setSellingId(row.id); setSalePrice(""); setSaleMarketplace("csfloat"); setExecutingId(null); setActionError(null); }}
            >
              Mark Sold
            </button>
          )}
          <button type="button" className="preview-btn preview-btn--quiet" onClick={() => void handleRemove(row.id)}>
            Remove
          </button>
        </span>
      ),
    },
  ];

  const empty = ACCOUNT_EMPTY[activeTab];
  const claimCount = claimTradeUps.length;
  const listCount = entries.length;
  const tabCount = activeTab === "claims" ? claimCount : listCount;

  if (location.pathname === "/account") {
    return <Navigate to="/my-trade-ups" replace />;
  }

  return (
    <div className="preview-page">
      <header className="preview-page__head">
        <div>
          <h1>My trade-ups</h1>
          <p>Claims, purchased rows, and realized P/L from the live APIs.</p>
        </div>
        {user && (
          <div className="preview-page__meta">
            <span>{user.display_name}</span>
            <i />
            <span>{user.tier}</span>
          </div>
        )}
      </header>

      {user === undefined && <p className="preview-note">Checking session…</p>}

      {user === null && (
        <section className="preview-panel">
          <header className="preview-panel__head">
            <p className="o-kicker">Session</p>
          </header>
          <p className="preview-note">Sign in to see claims and Pro delivery.</p>
          <a className="preview-btn preview-btn--lime preview-btn--block" href={authHref("/my-trade-ups")} rel="nofollow">
            Sign in with Steam
          </a>
        </section>
      )}

      {user && stats && (
        <div className="preview-stats">
          <div>
            <b>{stats.total_sold}</b>
            <span>Sold</span>
          </div>
          <div>
            <b className={signClass(stats.all_time_profit_cents)}>{signedDollars(stats.all_time_profit_cents)}</b>
            <span>All-time profit</span>
          </div>
          <div>
            <b>{stats.total_executed}</b>
            <span>Executed</span>
          </div>
          <div>
            <b>{stats.win_rate}%</b>
            <span>Win rate · {stats.avg_roi}% avg ROI</span>
          </div>
        </div>
      )}

      {user && (
        <div className="preview-tabs" role="tablist" aria-label="My trade-ups">
          {ACCOUNT_TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              role="tab"
              className="o-tab"
              aria-selected={activeTab === tab.key}
              data-state={activeTab === tab.key ? "active" : "inactive"}
              onClick={() => {
                setActiveTab(tab.key);
                setExecutingId(null);
                setSellingId(null);
                setConfirmModeId(null);
                setActionError(null);
              }}
            >
              {tab.label}
              {activeTab === tab.key && tabCount > 0 ? ` (${tabCount})` : ""}
            </button>
          ))}
        </div>
      )}

      {note && <p className="preview-note">{note}</p>}
      {actionError && <p className="preview-note preview-note--loss">{actionError}</p>}
      {user && loading && <p className="preview-note">Loading…</p>}

      {user && !loading && activeTab === "claims" && claimTradeUps.length === 0 && (
        <div className="preview-empty">
          <p>{empty.title}</p>
          <p className="preview-note">{empty.sub}</p>
        </div>
      )}

      {user && activeTab === "claims" && claimTradeUps.length > 0 && (
        <div className="preview-claims" data-face-tick={faceTick}>
          {claimTradeUps.map((tu) => {
            const mine = claimedIds.has(tu.id) || !!tu.claimed_by_me;
            const expires = claimExpiries.get(tu.id) ?? tu.claim_expires_at;
            const confirming = confirmModeId === tu.id;
            const verify = verifyById.get(tu.id);
            const realIds = realListingIds(tu);
            return (
              <div key={tu.id} className="preview-claim">
                <TradeUpCard tu={tu} expanded={expandedId === tu.id} onExpand={setExpandedId} />
                <div className="preview-claim__actions">
                  {expires && mine && <ClaimTimer expiresAt={expires} />}
                  <button
                    type="button"
                    className="preview-btn"
                    disabled={verifyingId === tu.id}
                    onClick={() => void handleVerify(tu.id)}
                  >
                    {verifyingId === tu.id ? "Verifying…" : "Verify"}
                  </button>
                  {!mine && (
                    <button type="button" className="preview-btn preview-btn--lime" onClick={() => void handleClaim(tu.id)}>
                      Claim
                    </button>
                  )}
                  {mine && !confirming && (
                    <>
                      <button type="button" className="preview-btn preview-btn--lime" onClick={() => beginConfirm(tu)}>
                        Confirm Purchase
                      </button>
                      <button type="button" className="preview-btn" onClick={() => void handleUnclaim(tu.id)}>
                        Release
                      </button>
                    </>
                  )}
                  {mine && confirming && (
                    <>
                      <span className="preview-note">{confirmSelected.size} of {realIds.length} selected</span>
                      <button
                        type="button"
                        className="preview-btn preview-btn--lime"
                        disabled={confirmSelected.size === 0}
                        onClick={() => void handleConfirmPurchased(tu)}
                      >
                        {confirmSelected.size === realIds.length ? "Confirm All" : `Confirm ${confirmSelected.size}`}
                      </button>
                      <button type="button" className="preview-btn" onClick={() => { setConfirmModeId(null); setConfirmSelected(new Set()); }}>
                        Cancel
                      </button>
                    </>
                  )}
                </div>
                {confirming && (
                  <div className="preview-picks">
                    {tu.inputs.filter((row) => realListingIds({ inputs: [row] }).length > 0).map((row) => (
                      <label key={row.listing_id} className={`preview-pick ${confirmSelected.has(row.listing_id) ? "is-on" : ""}`}>
                        <input
                          type="checkbox"
                          checked={confirmSelected.has(row.listing_id)}
                          onChange={() => toggleConfirmListing(row.listing_id)}
                        />
                        <span className="preview-faces__art"><Face name={row.skin_name} /></span>
                        <span className="preview-outcome__name">{row.skin_name}</span>
                        <span className="preview-chip">{row.condition}</span>
                        <span className="o-mono">{row.float_value.toFixed(4)}</span>
                        <span className="o-mono">{formatDollars(row.price_cents)}</span>
                      </label>
                    ))}
                  </div>
                )}
                {verify?.inputs && (
                  <div className="preview-verify">
                    <p className="o-kicker">Verify</p>
                    {verify.inputs.map((row) => (
                      <div key={row.listing_id} className="preview-pick">
                        <span className="preview-chip">{row.status}</span>
                        <span className="preview-outcome__name">{row.skin_name}</span>
                        <span className="o-mono">{formatDollars(row.original_price)}</span>
                        {row.price_changed && row.current_price != null && (
                          <span className="o-mono">{formatDollars(row.current_price)}</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {user && executing && (
        <section className="preview-confirm" aria-label="Confirm you executed">
          <header className="preview-panel__head">
            <p className="o-kicker">Select the outcome you received</p>
          </header>
          <div className="preview-outcomes">
            {executing.snapshot_outcomes.map((out: SnapshotOutcome, index: number) => {
              const delta = out.price_cents - executing.total_cost_cents;
              return (
                <label key={`${out.skin_id}-${index}`} className={`preview-outcome ${selectedOutcome === index ? "is-on" : ""}`}>
                  <input
                    type="radio"
                    name="outcome"
                    checked={selectedOutcome === index}
                    onChange={() => setSelectedOutcome(index)}
                  />
                  <span className="preview-faces__art"><Face name={out.skin_name} /></span>
                  <span className="preview-outcome__name">{out.skin_name}</span>
                  <span className="preview-chip">{out.condition}</span>
                  <span className={`o-mono ${signClass(delta)}`}>{signedDollars(delta)}</span>
                  <span className="preview-note">{(out.probability * 100).toFixed(1)}%</span>
                </label>
              );
            })}
          </div>
          <div className="preview-toolbar">
            <button type="button" className="preview-btn preview-btn--lime" disabled={selectedOutcome === null} onClick={() => void handleExecute(executing.id)}>
              Confirm Outcome
            </button>
            <button type="button" className="preview-btn" onClick={() => { setExecutingId(null); setSelectedOutcome(null); }}>
              Cancel
            </button>
          </div>
        </section>
      )}

      {user && selling && (
        <section className="preview-confirm" aria-label="Record sale">
          <header className="preview-panel__head">
            <p className="o-kicker">Record sale</p>
            <span className="preview-panel__meta">{selling.outcome_skin_name ?? "Output"}</span>
          </header>
          <div className="preview-toolbar">
            <label className="preview-field">
              Sale price ($)
              <input
                className="preview-field__num preview-field__num--wide"
                type="number"
                step="0.01"
                min="0"
                value={salePrice}
                onChange={(event) => setSalePrice(event.target.value)}
                placeholder="0.00"
              />
            </label>
            <label className="preview-field">
              Marketplace
              <select
                className="preview-field__select"
                value={saleMarketplace}
                onChange={(event) => setSaleMarketplace(event.target.value)}
              >
                {MARKETPLACE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
          </div>
          {saleGuess && (
            <div className="preview-readouts">
              <div className="preview-readout"><em>Cost</em><b>{formatDollars(selling.total_cost_cents)}</b></div>
              <div className="preview-readout"><em>Sale</em><b>{formatDollars(saleCents ?? 0)}</b></div>
              <div className="preview-readout">
                <em>Profit</em>
                <b className={signClass(saleGuess.profitCents)}>{signedDollars(saleGuess.profitCents)}</b>
              </div>
              <div className="preview-readout">
                <em>ROI</em>
                <b className={signClass(saleGuess.profitCents)}>{saleGuess.roi.toFixed(1)}%</b>
              </div>
            </div>
          )}
          <div className="preview-toolbar">
            <button
              type="button"
              className="preview-btn preview-btn--lime"
              disabled={saleCents === null}
              onClick={() => void handleSell(selling.id)}
            >
              Confirm Sale
            </button>
            <button type="button" className="preview-btn" onClick={() => { setSellingId(null); setSalePrice(""); }}>
              Cancel
            </button>
          </div>
        </section>
      )}

      {user && !loading && activeTab !== "claims" && entries.length === 0 && (
        <div className="preview-empty">
          <p>{empty.title}</p>
          <p className="preview-note">{empty.sub}</p>
        </div>
      )}

      {user && activeTab !== "claims" && entries.length > 0 && (
        <section className="preview-panel">
          <header className="preview-panel__head">
            <p className="o-kicker">{activeTab === "purchased" ? "Purchased" : "History"}</p>
            <span className="preview-panel__meta">{entries.length}</span>
          </header>
          <PreviewTable
            columns={columns}
            rows={entries}
            rowKey={(row) => String(row.id)}
            initialSort="dates"
            initialDirection="desc"
            empty={empty.title}
          />
        </section>
      )}

      <div className="preview-toolbar">
        <a className="preview-btn" href="/pricing">Pricing</a>
        {user && <a className="preview-btn" href="/auth/logout">Sign out</a>}
      </div>
    </div>
  );
}
