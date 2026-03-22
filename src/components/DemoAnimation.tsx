import { useEffect, useRef, useCallback } from 'react';

// Self-contained animated product demo for the landing page
// Replaces the static tradeuptable.png screenshot

export function DemoAnimation() {
  const screenRef = useRef<HTMLDivElement>(null);
  const cursorRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const runningRef = useRef(true);

  const sleep = (ms: number) => new Promise<void>(r => {
    const id = setTimeout(r, ms);
    return () => clearTimeout(id);
  });

  const getElPos = useCallback((el: HTMLElement) => {
    const sr = screenRef.current!.getBoundingClientRect();
    const er = el.getBoundingClientRect();
    return { x: er.left - sr.left + er.width / 2, y: er.top - sr.top + er.height / 2 };
  }, []);

  const moveTo = useCallback(async (el: HTMLElement, d = 800) => {
    const p = getElPos(el);
    const cur = cursorRef.current!;
    const ring = ringRef.current!;
    cur.style.transitionDuration = d + 'ms';
    cur.style.left = p.x + 'px';
    cur.style.top = p.y + 'px';
    ring.style.left = (p.x + 4) + 'px';
    ring.style.top = (p.y + 4) + 'px';
    await sleep(d + 80);
  }, [getElPos]);

  const click = useCallback(async () => {
    const ring = ringRef.current!;
    ring.classList.remove('demo-pop');
    void ring.offsetWidth;
    ring.classList.add('demo-pop');
    await sleep(350);
  }, []);

  const showTip = useCallback((html: string, el: HTMLElement) => {
    const tip = tipRef.current!;
    const p = getElPos(el);
    tip.innerHTML = html;
    let tx = p.x + 30, ty = p.y - 40;
    if (tx + 300 > 1180) tx = p.x - 310;
    if (ty < 10) ty = p.y + 30;
    if (ty + 80 > 560) ty = p.y - 80;
    tip.style.left = tx + 'px';
    tip.style.top = ty + 'px';
    tip.style.opacity = '1';
  }, [getElPos]);

  const hideTip = useCallback(() => {
    tipRef.current!.style.opacity = '0';
  }, []);

  useEffect(() => {
    runningRef.current = true;

    async function demo() {
      while (runningRef.current) {
        const screen = screenRef.current;
        if (!screen) return;

        await sleep(1200);
        if (!runningRef.current) return;

        const knifePill = screen.querySelector<HTMLElement>('[data-pill="knife"]')!;
        const allPill = screen.querySelector<HTMLElement>('[data-pill="all"]')!;
        const r0 = screen.querySelector<HTMLElement>('[data-row="0"]')!;
        const profitCell = r0.querySelectorAll<HTMLElement>('td')[2];
        const expandIcon = screen.querySelector<HTMLElement>('[data-expand]')!;
        const oc0 = screen.querySelector<HTMLElement>('[data-outcome="0"]')!;
        const vb = screen.querySelector<HTMLElement>('[data-verify]')!;
        const cb = screen.querySelector<HTMLElement>('[data-claim]')!;
        const ca = screen.querySelector<HTMLElement>('[data-claim-actions]')!;
        const ct = screen.querySelector<HTMLElement>('[data-claim-text]')!;
        const confBtn = screen.querySelector<HTMLElement>('[data-confirm]')!;
        const firstInput = screen.querySelector<HTMLElement>('[data-input]')!;
        const thirdInput = screen.querySelectorAll<HTMLElement>('[data-input]')[2]!;
        const expRow = screen.querySelector<HTMLElement>('[data-expanded]')!;
        const statline = screen.querySelector<HTMLElement>('[data-stats]')!;

        // Step 1: Search
        await moveTo(knifePill);
        showTip('<span class="demo-step-num">1</span> <em>Search</em> for the perfect trade-up — filter by rarity, sort by profit', knifePill);
        await sleep(2000); if (!runningRef.current) return;
        hideTip(); await sleep(200); await click();
        allPill.className = 'demo-pill';
        knifePill.className = 'demo-pill demo-pill-knife';
        statline.innerHTML = '8,421 found (<span class="demo-green">2,847 profitable</span>)';
        await sleep(800);

        await moveTo(profitCell);
        showTip('<span class="demo-step-num">1</span> Sorted by <em>profit</em> — $306 on a $1,467 investment at <em>20.9% ROI</em>', profitCell);
        r0.classList.add('demo-row-hl');
        await sleep(3000); if (!runningRef.current) return;
        hideTip();

        await moveTo(expandIcon); await sleep(200); await click();
        expRow.style.display = 'table-row';
        expandIcon.textContent = '▼';
        await sleep(600);

        await moveTo(oc0);
        showTip('<span class="demo-step-num">1</span> <em>24 possible glove outcomes</em> — Hedge Maze +$4,631, Pandora\'s Box +$4,116', oc0);
        oc0.classList.add('demo-ocard-hl');
        await sleep(3500); if (!runningRef.current) return;
        oc0.classList.remove('demo-ocard-hl');
        hideTip();

        // Step 2: Verify
        await moveTo(vb);
        showTip('<span class="demo-step-num">2</span> <em>Verify</em> all listings are still available before buying', vb);
        await sleep(500); await click();
        vb.textContent = 'Checking...';
        vb.className = 'demo-verify demo-verify-checking';
        await sleep(1500);
        vb.textContent = 'All listed ✓';
        vb.className = 'demo-verify demo-verify-done';
        await sleep(2000); if (!runningRef.current) return;
        hideTip();

        // Step 3: Claim
        await moveTo(cb);
        showTip('<span class="demo-step-num">3</span> <em>Claim</em> to lock all 5 listings for 30 min — nobody else can take them', cb);
        await sleep(1500); await click();
        cb.style.display = 'none';
        ct.innerHTML = '<span style="color:#c084fc;font-weight:500">You claimed this trade-up</span> — confirm purchase or release';
        ca.style.display = 'flex';
        await sleep(2500); if (!runningRef.current) return;
        hideTip();

        // Step 4: Purchase
        await moveTo(firstInput);
        showTip('<span class="demo-step-num">4</span> <em>Purchase</em> — click any input to go directly to the marketplace listing', firstInput);
        await sleep(2000); await click();
        await sleep(500); hideTip();

        await moveTo(thirdInput);
        showTip('<span class="demo-step-num">4</span> Buy all 5 inputs on <em>DMarket</em> and <em>CSFloat</em> — total: <em>$1,466.87</em>', thirdInput);
        await sleep(3000); if (!runningRef.current) return;
        hideTip();

        // Step 5: Confirm
        await moveTo(confBtn);
        showTip('<span class="demo-step-num">5</span> <em>Confirm purchase</em> and complete your trade-up — good luck!', confBtn);
        await sleep(3500); if (!runningRef.current) return;
        hideTip();

        // Reset
        await sleep(1500);
        expRow.style.display = 'none';
        expandIcon.textContent = '▶';
        r0.classList.remove('demo-row-hl');
        cb.style.display = '';
        cb.textContent = 'Claim (8/10)';
        cb.className = 'demo-claim-btn';
        ca.style.display = 'none';
        ct.textContent = 'Claim to lock listings for 30 min while you buy';
        vb.textContent = 'Verify (20/20)';
        vb.className = 'demo-verify';
        knifePill.className = 'demo-pill';
        allPill.className = 'demo-pill demo-pill-all';
        statline.innerHTML = '592,938 found (<span class="demo-green">28,493 profitable</span>)';
        const cur = cursorRef.current!;
        cur.style.transitionDuration = '400ms';
        cur.style.left = '600px';
        cur.style.top = '300px';
        await sleep(2500);
      }
    }

    demo();
    return () => { runningRef.current = false; };
  }, [moveTo, click, showTip, hideTip]);

  return (
    <div ref={screenRef} className="relative w-full overflow-hidden rounded-lg border border-border bg-[#111]" style={{ height: 580 }}>
      <style>{`
        .demo-cursor{position:absolute;width:20px;height:20px;pointer-events:none;z-index:100;transition:left .8s cubic-bezier(.4,0,.2,1),top .8s cubic-bezier(.4,0,.2,1);left:600px;top:300px}
        .demo-cursor svg{filter:drop-shadow(0 2px 4px rgba(0,0,0,.6))}
        .demo-ring{position:absolute;width:26px;height:26px;border-radius:50%;border:2px solid #22c55e;opacity:0;pointer-events:none;z-index:99}
        .demo-pop{animation:demoPop .5s ease-out}
        @keyframes demoPop{0%{opacity:.7;transform:scale(0)}100%{opacity:0;transform:scale(2)}}
        .demo-tip{position:absolute;background:#161616;border:1px solid rgba(34,197,94,.2);border-radius:8px;padding:10px 16px;color:#d4d4d4;font-size:12px;line-height:1.5;max-width:300px;opacity:0;transition:opacity .4s;z-index:90;pointer-events:none}
        .demo-tip em{color:#22c55e;font-style:normal;font-weight:600}
        .demo-step-num{display:inline-block;background:#22c55e;color:#000;font-weight:700;font-size:10px;width:18px;height:18px;border-radius:50%;text-align:center;line-height:18px;margin-right:6px}
        .demo-pill{font-size:12px;padding:4px 14px;border-radius:999px;border:1px solid transparent;color:#737373;font-weight:500}
        .demo-pill-all{border-color:rgba(229,229,229,.25);background:rgba(229,229,229,.06);color:#e5e5e5}
        .demo-pill-knife{border-color:rgba(234,179,8,.4);background:rgba(234,179,8,.1);color:#eab308;font-weight:600}
        .demo-row-hl{background:#1a1a1a}
        .demo-green{color:#22c55e}
        .demo-tbl td.demo-pos,.demo-pos{color:#22c55e;font-weight:600}
        .demo-tbl td.demo-neg,.demo-neg{color:#ef4444;font-weight:600}
        .demo-roi{display:inline-block;padding:2px 8px;border-radius:4px;font-weight:600;font-size:12.5px;background:rgba(34,197,94,.15);color:#22c55e}
        .demo-ch{display:inline-block;padding:2px 8px;border-radius:4px;font-weight:600;font-size:12.5px}
        .demo-ch-md{background:rgba(245,158,11,.15);color:#fbbf24}
        .demo-ch-hi{background:rgba(34,197,94,.2);color:#4ade80}
        .demo-colb{display:inline-block;font-size:9.5px;padding:1px 5px;border-radius:3px;background:#1e293b;color:#94a3b8;border:1px solid #334155;margin-left:4px}
        .demo-age{font-size:9px;color:rgba(115,115,115,.5);margin-left:6px}
        .demo-inp{font-size:12.5px;color:rgba(229,229,229,.6)}
        .demo-inp a{color:inherit;text-decoration:none;border-bottom:1px dotted rgba(163,163,163,.3)}
        .demo-claim-bar{display:flex;align-items:center;justify-content:space-between;padding:8px 14px;background:rgba(34,197,94,.03);border:1px solid rgba(34,197,94,.15);border-radius:8px;margin-bottom:14px}
        .demo-claim-text{font-size:11px;color:#86efac}
        .demo-claim-btn{padding:5px 16px;font-size:11px;font-weight:600;border-radius:6px;border:1px solid rgba(168,85,247,.5);background:rgba(88,28,135,.3);color:#c084fc;cursor:pointer}
        .demo-confirm-btn{padding:4px 12px;font-size:10px;font-weight:600;border-radius:5px;border:1px solid rgba(34,197,94,.5);background:rgba(20,83,45,.3);color:#4ade80}
        .demo-release-btn{padding:4px 12px;font-size:10px;font-weight:500;border-radius:5px;border:1px solid #333;background:transparent;color:#a3a3a3}
        .demo-verify{padding:4px 12px;font-size:10px;font-weight:600;border-radius:5px;border:1px solid #262626;background:#1a1a1a;color:#60a5fa;margin-left:8px}
        .demo-verify-checking{color:#fbbf24;border-color:rgba(245,158,11,.3)}
        .demo-verify-done{color:#4ade80;border-color:rgba(34,197,94,.3)}
        .demo-bar{border-radius:2px 2px 0 0;flex:1;position:relative;min-width:8px}
        .demo-bar-loss{background:rgba(127,29,29,.6);border:1px solid rgba(153,27,27,.4);border-bottom:0}
        .demo-bar-win{background:rgba(20,83,45,.6);border:1px solid rgba(22,101,52,.4);border-bottom:0}
        .demo-bar .pct{position:absolute;top:1px;left:50%;transform:translateX(-50%);font-size:8px;color:rgba(229,229,229,.6);white-space:nowrap}
        .demo-icard{background:rgba(163,163,163,.04);border:1px solid rgba(255,255,255,.06);border-radius:6px;padding:5px 7px}
        .demo-src{display:inline-block;font-size:7px;font-weight:700;padding:0 3px;border-radius:2px;color:#fff;margin-right:2px}
        .demo-src-dm{background:#4f8cff}
        .demo-src-cs{background:#6366f1}
        .demo-ocard{background:rgba(163,163,163,.04);border:1px solid rgba(255,255,255,.06);border-radius:6px;padding:7px 9px;transition:all .25s}
        .demo-ocard-hl{border-color:rgba(34,197,94,.3)!important;background:rgba(34,197,94,.04)!important}
        .demo-tbl{width:100%;border-collapse:collapse}
        .demo-tbl th{text-align:left;padding:8px 14px;font-size:13px;color:#737373;font-weight:600;background:#151515;border-bottom:1px solid #1f1f1f;white-space:nowrap}
        .demo-tbl td{padding:10px 14px;font-size:13px;color:#d4d4d4;border-bottom:1px solid rgba(255,255,255,.04)}
        .demo-tbl tr{transition:background .15s}
      `}</style>

      {/* Cursor */}
      <div ref={cursorRef} className="demo-cursor">
        <svg width="20" height="20" viewBox="0 0 24 24"><path d="M5.5 3.21V20.8c0 .45.54.67.85.35l4.86-4.86a.5.5 0 0 1 .35-.15h6.87a.5.5 0 0 0 .35-.85L6.35 2.86a.5.5 0 0 0-.85.35z" fill="#fff" stroke="#000" strokeWidth="1"/></svg>
      </div>
      <div ref={ringRef} className="demo-ring" />
      <div ref={tipRef} className="demo-tip" />

      {/* Type pills */}
      <div className="flex gap-1.5 px-4 py-2.5 border-b border-[#1a1a1a]">
        <div data-pill="all" className="demo-pill demo-pill-all">All</div>
        <div data-pill="knife" className="demo-pill">Knife/Gloves</div>
        <div className="demo-pill">Covert</div>
        <div className="demo-pill">Classified</div>
        <div className="demo-pill">Restricted</div>
        <div className="demo-pill">Mil-Spec</div>
        <div className="demo-pill">Industrial</div>
      </div>

      {/* Filters */}
      <div className="flex gap-2 px-4 py-2 items-center">
        <input className="bg-[#161616] border border-[#262626] rounded-md px-2.5 py-1.5 text-[#737373] text-[11px] w-[150px]" placeholder="Filter by skin..." readOnly />
        <input className="bg-[#161616] border border-[#262626] rounded-md px-2.5 py-1.5 text-[#737373] text-[11px] w-[150px]" placeholder="Filter by collection..." readOnly />
        <div className="text-[11px] px-3 py-1 rounded-full border border-[#262626] text-[#737373]">Profit ▾</div>
        <div className="text-[11px] px-3 py-1 rounded-full border border-[#262626] text-[#737373]">ROI ▾</div>
        <div className="text-[11px] px-3 py-1 rounded-full border border-[#262626] text-[#737373]">Cost ▾</div>
        <div className="text-[11px] px-3 py-1 rounded-full border border-[#262626] text-[#737373]">Chance ▾</div>
        <div className="text-[11px] px-3 py-1 rounded-full border border-[#262626] text-[#737373]">Max Loss ▾</div>
        <div className="text-[11px] px-3 py-1 rounded-full border border-[#262626] text-[#737373]">Best Win ▾</div>
        <div className="ml-auto text-[11px] text-[#525252] flex items-center gap-1"><input type="checkbox" disabled /> Show stale</div>
      </div>

      <div data-stats className="px-4 py-1 text-[11px] text-[#525252]">592,938 found (<span className="demo-green">28,493 profitable</span>)</div>

      {/* Table */}
      <div className="overflow-hidden" style={{ maxHeight: 460 }}>
        <table className="demo-tbl">
          <thead><tr>
            <th style={{ width: 24 }} /><th>Inputs</th><th>Profit ↓</th><th>ROI</th><th>Chance</th><th>Cost</th><th>EV</th><th>Best</th><th>Worst</th>
          </tr></thead>
          <tbody>
            <tr data-row="0">
              <td className="text-[#525252] text-[10px] w-6 text-center" data-expand>▶</td>
              <td><span className="demo-inp"><a>4× M4A4 | Buzz Kill</a>, <a>1× SSG 08 | Dragonfire</a></span> <span className="demo-colb">Glove</span> <span className="demo-age">(2h)</span></td>
              <td className="demo-pos">$306.42</td>
              <td><span className="demo-roi">20.9%</span></td>
              <td><span className="demo-ch demo-ch-md">46%</span></td>
              <td>$1,466.87</td><td>$1,773.29</td><td className="demo-pos">$4,631.58</td><td className="demo-neg">-$1,256.40</td>
            </tr>
            <tr data-expanded style={{ display: 'none' }}><td colSpan={9} className="!p-0 !bg-[#0f0f0f]"><div className="py-4 px-5 pl-11">
              {/* Claim bar */}
              <div className="demo-claim-bar">
                <span className="demo-claim-text" data-claim-text>Claim to lock listings for 30 min while you buy</span>
                <div className="flex gap-1.5 items-center">
                  <button className="demo-claim-btn" data-claim>Claim (8/10)</button>
                  <div data-claim-actions style={{ display: 'none', gap: 6 }} className="items-center">
                    <button className="demo-confirm-btn" data-confirm>Confirm Purchase</button>
                    <button className="demo-release-btn">Release</button>
                  </div>
                </div>
              </div>

              {/* Distribution */}
              <div className="mb-3.5">
                <div className="flex justify-between mb-1.5">
                  <span className="text-[11px] text-[#737373] uppercase tracking-wide">Outcome Distribution</span>
                  <span className="text-[10px] text-[#525252]">$1000 bins</span>
                </div>
                <div className="h-[70px] flex items-end gap-0.5 border-b border-[#262626] mb-1">
                  <div className="demo-bar demo-bar-loss" style={{ height: '48%' }}><span className="pct">16.7%</span></div>
                  <div className="demo-bar demo-bar-loss" style={{ height: '48%' }}><span className="pct">16.7%</span></div>
                  <div className="demo-bar demo-bar-loss" style={{ height: '60%' }}><span className="pct">20.8%</span></div>
                  <div className="demo-bar demo-bar-win" style={{ height: '48%' }}><span className="pct">16.7%</span></div>
                  <div className="demo-bar demo-bar-win" style={{ height: '48%' }}><span className="pct">16.7%</span></div>
                  <div className="demo-bar demo-bar-win" style={{ height: '36%' }}><span className="pct">12.5%</span></div>
                </div>
                <div className="flex justify-between text-[8px] mb-0.5">
                  <span className="text-red-600/50">-$1,256</span><span className="text-red-600/50">-$500</span><span className="text-[#525252]">← Loss | Profit →</span><span className="text-green-600/50">$2,000</span><span className="text-green-600/50">$4,631</span>
                </div>
                <div className="flex justify-between text-[10px] text-[#525252] mt-1">
                  <span>EV: <strong className="text-green-500">$306.42</strong></span><span>24 outcomes in 6 bins</span>
                </div>
              </div>

              {/* Inputs */}
              <div className="text-[11px] text-[#737373] uppercase tracking-wide mb-2 mt-3">Inputs (5) <span className="demo-verify" data-verify>Verify (20/20)</span></div>
              <div className="grid grid-cols-5 gap-1.5">
                {[
                  { src: 'dm', name: 'M4A4 | Buzz Kill', fl: 'FT 0.2484', pr: '$292.00' },
                  { src: 'dm', name: 'M4A4 | Buzz Kill', fl: 'FT 0.2194', pr: '$292.00' },
                  { src: 'dm', name: 'M4A4 | Buzz Kill', fl: 'FT 0.1825', pr: '$293.93' },
                  { src: 'dm', name: 'M4A4 | Buzz Kill', fl: 'FT 0.3395', pr: '$293.94' },
                  { src: 'cs', name: 'SSG 08 | Dragonfire', fl: 'FT 0.1513', pr: '$295.00' },
                ].map((inp, i) => (
                  <div key={i} className="demo-icard" data-input>
                    <div className="text-[10px] text-[#d4d4d4] font-medium whitespace-nowrap overflow-hidden text-ellipsis">
                      <span className={`demo-src demo-src-${inp.src}`}>{inp.src === 'dm' ? 'DM' : 'CS'}</span>
                      <a>{inp.name}</a> <span className="text-[8px] font-semibold text-green-500 float-right">✓</span>
                    </div>
                    <div className="text-[9px] text-[#737373] mt-px">{inp.fl}</div>
                    <div className="text-[10px] text-white/80 font-semibold mt-px">{inp.pr}</div>
                  </div>
                ))}
              </div>

              {/* Outcomes */}
              <div className="text-[11px] text-[#737373] uppercase tracking-wide mb-2 mt-3">Possible Outcomes (24)</div>
              <div className="grid grid-cols-3 gap-1.5">
                {[
                  { name: 'Sport Gloves | Hedge Maze', prob: '4.2%', fl: 'FT 0.3140', delta: '+$4,631.58', pos: true, data: '38 listings · 12 sales · CSFloat' },
                  { name: "Sport Gloves | Pandora's Box", prob: '4.2%', fl: 'FT 0.3140', delta: '+$4,116.30', pos: true, data: '22 listings · 8 sales' },
                  { name: 'Moto Gloves | Spearmint', prob: '4.2%', fl: 'FT 0.3140', delta: '+$2,112.82', pos: true, data: '45 listings · 15 sales' },
                  { name: 'Sport Gloves | Superconductor', prob: '4.2%', fl: 'FT 0.3140', delta: '+$2,030.35', pos: true, data: '31 listings · 11 sales' },
                  { name: 'Specialist Gloves | Crimson Kimono', prob: '4.2%', fl: 'FT 0.3140', delta: '+$1,869.91', pos: true, data: '28 listings · 9 sales' },
                  { name: 'Driver Gloves | Crimson Weave', prob: '4.2%', fl: 'FT 0.3140', delta: '+$786.68', pos: true, data: '19 listings · 6 sales' },
                  { name: 'Hand Wraps | Leather', prob: '4.2%', fl: 'FT 0.3140', delta: '-$434.47', pos: false, data: '42 listings · 14 sales' },
                  { name: 'Driver Gloves | Convoy', prob: '4.2%', fl: 'FT 0.3140', delta: '-$1,032.84', pos: false, data: '15 listings · 4 sales' },
                  { name: 'Bloodhound Gloves | Snakebite', prob: '4.2%', fl: 'FT 0.3140', delta: '-$1,256.40', pos: false, data: '11 listings · 3 sales' },
                ].map((o, i) => (
                  <div key={i} className="demo-ocard" {...(i === 0 ? { 'data-outcome': '0' } : {})}>
                    <div className="flex justify-between items-baseline"><span className="text-[10px] text-[#d4d4d4] font-medium">{o.name}</span><span className="text-[10px] text-blue-400 font-semibold">{o.prob}</span></div>
                    <div className="flex justify-between items-baseline mt-0.5"><span className="text-[9px] text-[#737373]">{o.fl}</span><span className={`text-[10px] font-semibold ${o.pos ? 'demo-pos' : 'demo-neg'}`}>{o.delta}</span></div>
                    <div className="text-[8px] text-[#737373]/50 mt-0.5">{o.data}</div>
                  </div>
                ))}
              </div>
            </div></td></tr>

            {/* Other rows */}
            {[
              { inputs: '3× M4A4 | Buzz Kill, 2× SSG 08 | Dragonfire', profit: '$298.43', roi: '20.4%', chance: '46%', chCls: 'demo-ch-md', cost: '$1,464.38', ev: '$1,762.81', best: '$4,631.07', worst: '-$1,254.73', age: '2h' },
              { inputs: '5× M4A4 | Buzz Kill', profit: '$296.58', roi: '20.3%', chance: '46%', chCls: 'demo-ch-md', cost: '$1,463.87', ev: '$1,760.45', best: '$4,634.58', worst: '-$1,248.91', age: '1h' },
              { inputs: '5× M4A4 | Buzz Kill', profit: '$296.03', roi: '20.2%', chance: '46%', chCls: 'demo-ch-md', cost: '$1,463.87', ev: '$1,759.90', best: '$4,634.58', worst: '-$1,254.30', age: '1h' },
              { inputs: '3× M4A4 | Buzz Kill, 2× SSG 08 | Dragonfire', profit: '$295.73', roi: '20.2%', chance: '42%', chCls: 'demo-ch-md', cost: '$1,464.38', ev: '$1,760.11', best: '$4,631.07', worst: '-$1,253.98', age: '3h' },
              { inputs: '4× M4A4 | Buzz Kill, 1× AK-47 | Neon Rider', profit: '$289.15', roi: '19.8%', chance: '46%', chCls: 'demo-ch-md', cost: '$1,458.92', ev: '$1,748.07', best: '$4,580.22', worst: '-$1,240.16', age: '1h' },
              { inputs: '5× SSG 08 | Dragonfire', profit: '$284.90', roi: '19.5%', chance: '42%', chCls: 'demo-ch-md', cost: '$1,462.50', ev: '$1,747.40', best: '$4,631.58', worst: '-$1,262.50', age: '4h' },
              { inputs: '3× M4A4 | Buzz Kill, 2× AK-47 | Neon Rider', profit: '$281.33', roi: '19.3%', chance: '46%', chCls: 'demo-ch-md', cost: '$1,455.44', ev: '$1,736.77', best: '$4,580.22', worst: '-$1,235.80', age: '2h' },
              { inputs: '4× SSG 08 | Dragonfire, 1× M4A4 | Buzz Kill', profit: '$278.62', roi: '19.1%', chance: '42%', chCls: 'demo-ch-md', cost: '$1,461.25', ev: '$1,739.87', best: '$4,631.07', worst: '-$1,258.73', age: '3h' },
            ].map((r, i) => (
              <tr key={i}>
                <td className="text-[#525252] text-[10px] w-6 text-center">▶</td>
                <td><span className="demo-inp"><a>{r.inputs}</a></span> <span className="demo-colb">Glove</span> <span className="demo-age">({r.age})</span></td>
                <td className="demo-pos">{r.profit}</td>
                <td><span className="demo-roi">{r.roi}</span></td>
                <td><span className={`demo-ch ${r.chCls}`}>{r.chance}</span></td>
                <td>{r.cost}</td><td>{r.ev}</td><td className="demo-pos">{r.best}</td><td className="demo-neg">{r.worst}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
