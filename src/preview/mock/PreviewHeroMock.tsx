import { SkinRender } from "../images/SkinRender.js";

/** Real Steam CDN renders of real CS2 skins. Used only as a marketing mock. */
const REDLINE = "https://community.akamai.steamstatic.com/economy/image/i0CoZ81Ui0m-9KwlBY1L_18myuGuq1wfhWSaZgMttyVfPaERSR0Wqmu7LAocGIGz3UqlXOLrxM-vMGmW8VNxu5Dx60noTyLwlcK3wiFO0POlPPNSI_-RHGavzedxuPUnFniykEtzsWWBzoyuIiifaAchDZUjTOZe4RC_w4buM-6z7wzbgokUyzK-0H08hRGDMA";
const ASIIMOV = "https://community.akamai.steamstatic.com/economy/image/i0CoZ81Ui0m-9KwlBY1L_18myuGuq1wfhWSaZgMttyVfPaERSR0Wqmu7LAocGIGz3UqlXOLrxM-vMGmW8VNxu5Dx60noTyLwiYbf_jdk7uW-V6V-Kf2cGFidxOp_pewnF3nhxEt0sGnSzN76dH3GOg9xC8FyEORftRe-x9PuYurq71bW3d8UnjK-0H0YSTpMGQ";
const MOCK_INPUTS = Array.from({ length: 10 }, () => "AK-47 | Redline");

function MockCard({
  output,
  image,
  cost,
  ev,
  profit,
  chance,
}: {
  output: string;
  image: string;
  cost: string;
  ev: string;
  profit: string;
  chance: string;
}) {
  return (
    <article className="pv-card" style={{ cursor: "default" }}>
      <div className="pv-hero-skin">
        <SkinRender name={output} url={image} />
      </div>
      <div className="pv-card-body">
        <div className="pv-card-name">{output}</div>
        <div className="pv-slots">
          {MOCK_INPUTS.map((name, i) => (
            <div key={`${name}-${i}`} className="pv-slot">
              <SkinRender name={name} url={REDLINE} />
            </div>
          ))}
        </div>
        <dl className="pv-statrow">
          <div><dt>Cost</dt><dd className="pv-tabular">{cost}</dd></div>
          <div><dt>EV</dt><dd className="pv-tabular">{ev}</dd></div>
          <div><dt>Profit</dt><dd className={`pv-tabular ${profit.startsWith("+") ? "pv-profit" : "pv-loss"}`}>{profit}</dd></div>
          <div><dt>Chance</dt><dd className="pv-tabular">{chance}</dd></div>
        </dl>
      </div>
    </article>
  );
}

export function PreviewHeroMock() {
  return (
    <div className="pv-laptop">
      <div className="pv-laptop-lid">
        <div className="pv-laptop-screen">
          <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", minHeight: 420 }}>
            <div style={{ borderRight: "1px solid #262626", padding: 14 }}>
              <div className="pv-kicker">Board</div>
              <div style={{ marginTop: 14, fontSize: 13 }} className="pv-muted">Contracts</div>
              <div style={{ marginTop: 8, fontSize: 13 }}>Calculator</div>
              <div style={{ marginTop: 8, fontSize: 13 }} className="pv-muted">Account</div>
            </div>
            <div style={{ padding: 14, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <MockCard output="AWP | Asiimov" image={ASIIMOV} cost="$184" ev="$231" profit="+$47" chance="61%" />
              <MockCard output="AK-47 | Redline" image={REDLINE} cost="$42" ev="$39" profit="−$3" chance="28%" />
            </div>
          </div>
        </div>
      </div>
      <div className="pv-laptop-base" />
    </div>
  );
}
