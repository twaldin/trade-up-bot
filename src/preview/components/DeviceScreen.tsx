import type { CSSProperties } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChartFigure } from "../kit/primitives/chart-figure.js";

const EV = [
  { w: "W1", ev: 184, cost: 142 },
  { w: "W2", ev: 196, cost: 151 },
  { w: "W3", ev: 211, cost: 148 },
  { w: "W4", ev: 228, cost: 155 },
  { w: "W5", ev: 241, cost: 160 },
  { w: "W6", ev: 236, cost: 158 },
  { w: "W7", ev: 254, cost: 162 },
  { w: "W8", ev: 271, cost: 166 },
];

const RAILS = [
  { name: "CF", cf: 42, dm: 18, sp: 12, bf: 6 },
  { name: "DM", cf: 21, dm: 34, sp: 9, bf: 4 },
  { name: "SP", cf: 14, dm: 11, sp: 28, bf: 3 },
  { name: "BF", cf: 8, dm: 6, sp: 5, bf: 19 },
];

const ROWS = [
  { skin: "AK-47 | Redline", rail: "CSFloat", amount: "$12.40", status: "Buyable" },
  { skin: "M4A1-S | Nitro", rail: "DMarket", amount: "$3.85", status: "Buyable" },
  { skin: "USP-S | Guardian", rail: "Skinport", amount: "$4.10", status: "Buyable" },
  { skin: "Glock-18 | Water Elemental", rail: "Buff", amount: "$8.90", status: "Exception" },
  { skin: "AWP | Worm God", rail: "CSFloat", amount: "$2.15", status: "Buyable" },
];

const KPIS = [
  { label: "Net EV", value: "$271", delta: "+8.4%" },
  { label: "In-policy", value: "94%", delta: "+1.2%" },
  { label: "Live listings", value: "10/10", delta: "fees in" },
  { label: "Chance", value: "71%", delta: "to profit" },
];

export function DeviceScreen({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`tub-console ${compact ? "tub-console--phone" : ""}`}>
      <aside className="tub-console__nav">
        {["Overview", "Contracts", "Listings", "Rails", "Controls"].map((item, i) => (
          <span key={item} data-active={i === 1}>{item}</span>
        ))}
      </aside>
      <div className="tub-console__main">
        <header className="tub-console__head">
          <strong>Live contracts</strong>
          <span>CSFloat · DMarket · Skinport · Buff</span>
        </header>
        <div className="tub-console__kpis">
          {KPIS.map((k, i) => (
            <div key={k.label} className="lg-figure" style={{ "--col": i } as CSSProperties}>
              <em>{k.label}</em>
              <b>{k.value}</b>
              <small>{k.delta}</small>
            </div>
          ))}
        </div>
        <div className="tub-console__charts">
          <ChartFigure
            title="Expected value vs cost, 8 weeks"
            description="Area chart of expected value over cost. EV stays above cost across the window."
            data={{ columns: ["Week", "EV", "Cost"], rows: EV.map((d) => [d.w, d.ev, d.cost]) }}
            className="tub-console__chart"
          >
            <ResponsiveContainer width="100%" height={compact ? 120 : 168}>
              <AreaChart data={EV} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="evFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#d7fe52" stopOpacity={0.45} />
                    <stop offset="100%" stopColor="#d7fe52" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="var(--line-soft)" />
                <XAxis dataKey="w" tick={{ fontSize: 11, fill: "var(--text-muted)" }} axisLine={false} tickLine={false} />
                <YAxis hide domain={["dataMin - 20", "dataMax + 10"]} />
                <Tooltip />
                <Area type="monotone" dataKey="cost" stroke="#acaba8" strokeWidth={2} fill="none" isAnimationActive={false} />
                <Area type="monotone" dataKey="ev" stroke="#d7fe52" strokeWidth={2} fill="url(#evFill)" isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </ChartFigure>
          {!compact && (
            <ChartFigure
              title="Settlement volume by rail"
              description="Stacked bars of listing volume by marketplace."
              data={{ columns: ["Rail", "CSFloat", "DMarket", "Skinport", "Buff"], rows: RAILS.map((r) => [r.name, r.cf, r.dm, r.sp, r.bf]) }}
              className="tub-console__chart"
            >
              <ResponsiveContainer width="100%" height={168}>
                <BarChart data={RAILS} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="var(--line-soft)" />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: "var(--text-muted)" }} axisLine={false} tickLine={false} />
                  <Tooltip />
                  <Bar dataKey="cf" stackId="a" fill="#d7fe52" isAnimationActive={false} />
                  <Bar dataKey="dm" stackId="a" fill="#4f8cff" isAnimationActive={false} />
                  <Bar dataKey="sp" stackId="a" fill="#f5a623" isAnimationActive={false} />
                  <Bar dataKey="bf" stackId="a" fill="#e85d04" isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </ChartFigure>
          )}
        </div>
        <table className="tub-console__table">
          <thead>
            <tr>
              <th>Skin</th>
              <th>Rail</th>
              <th>Amount</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.slice(0, compact ? 4 : 5).map((row) => (
              <tr key={row.skin}>
                <td>{row.skin}</td>
                <td>{row.rail}</td>
                <td>{row.amount}</td>
                <td data-ok={row.status === "Buyable"}>{row.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
