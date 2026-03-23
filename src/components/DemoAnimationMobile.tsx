import { useEffect, useRef, useCallback } from 'react';

// Mobile variant — card-based animated product demo in a phone frame

export function DemoAnimationMobile() {
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

  const moveTo = useCallback(async (el: HTMLElement, d = 700) => {
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
    ring.classList.remove('mdemo-pop');
    void ring.offsetWidth;
    ring.classList.add('mdemo-pop');
    await sleep(350);
  }, []);

  const showTip = useCallback((html: string, el: HTMLElement) => {
    const tip = tipRef.current!;
    const p = getElPos(el);
    tip.innerHTML = html;
    let tx = p.x + 20, ty = p.y - 35;
    if (tx + 280 > 370) tx = p.x - 280;
    if (tx < 8) tx = 8;
    if (ty < 45) ty = p.y + 25;
    if (ty + 60 > 680) ty = p.y - 60;
    tip.style.left = tx + 'px';
    tip.style.top = ty + 'px';
    tip.style.opacity = '1';
  }, [getElPos]);

  const hideTip = useCallback(() => {
    tipRef.current!.style.opacity = '0';
  }, []);

  const scrollCards = useCallback((container: HTMLElement, target: HTMLElement) => {
    return new Promise<void>(r => {
      const sr = container.getBoundingClientRect();
      const tr = target.getBoundingClientRect();
      const offset = tr.top - sr.top + container.scrollTop - 8;
      container.scrollTo({ top: offset, behavior: 'smooth' });
      setTimeout(r, 400);
    });
  }, []);

  useEffect(() => {
    runningRef.current = true;

    async function demo() {
      while (runningRef.current) {
        const screen = screenRef.current;
        if (!screen) return;

        const cardsEl = screen.querySelector<HTMLElement>('[data-cards]')!;
        if (cardsEl) cardsEl.scrollTop = 0;

        await sleep(1200);
        if (!runningRef.current) return;

        const knifePill = screen.querySelector<HTMLElement>('[data-mpill="knife"]')!;
        const allPill = screen.querySelector<HTMLElement>('[data-mpill="all"]')!;
        const card0 = screen.querySelector<HTMLElement>('[data-card="0"]')!;
        const profitEl = card0.querySelector<HTMLElement>('[data-mprofit]')!;
        const arrow0 = screen.querySelector<HTMLElement>('[data-marrow]')!;
        const exp0 = screen.querySelector<HTMLElement>('[data-mexpanded]')!;
        const oc0 = screen.querySelector<HTMLElement>('[data-moutcome="0"]')!;
        const vb = screen.querySelector<HTMLElement>('[data-mverify]')!;
        const cb = screen.querySelector<HTMLElement>('[data-mclaim]')!;
        const ca = screen.querySelector<HTMLElement>('[data-mclaim-actions]')!;
        const ct = screen.querySelector<HTMLElement>('[data-mclaim-text]')!;
        const confBtn = screen.querySelector<HTMLElement>('[data-mconfirm]')!;
        const inp0 = screen.querySelector<HTMLElement>('[data-minput="0"]')!;
        const inp2 = screen.querySelector<HTMLElement>('[data-minput="2"]')!;
        const claimBar = screen.querySelector<HTMLElement>('[data-mclaim-bar]')!;
        const statline = screen.querySelector<HTMLElement>('[data-mstats]')!;

        // Step 1: Search
        await moveTo(knifePill);
        showTip('<span class="mdemo-step-num">1</span> <em>Search</em> for the perfect trade-up — filter by rarity, sort by profit', knifePill);
        await sleep(2200); if (!runningRef.current) return;
        hideTip(); await sleep(200); await click();
        allPill.className = 'mdemo-tpill';
        knifePill.className = 'mdemo-tpill mdemo-tpill-knife';
        statline.innerHTML = '8,421 found (<span class="mdemo-green">2,847 profitable</span>)';
        await sleep(800);

        // Hover profit on card
        await moveTo(profitEl);
        showTip('<span class="mdemo-step-num">1</span> Sorted by <em>profit</em> — $306 on a $1,467 investment at <em>20.9% ROI</em>', profitEl);
        card0.classList.add('mdemo-card-hl');
        await sleep(3000); if (!runningRef.current) return;
        hideTip();

        // Expand card
        await moveTo(arrow0); await sleep(200); await click();
        exp0.style.display = 'block';
        arrow0.textContent = '▼';
        await sleep(400);

        // Scroll to outcomes
        if (cardsEl) await scrollCards(cardsEl, oc0);
        await sleep(300);

        // Outcomes
        await moveTo(oc0);
        showTip('<span class="mdemo-step-num">1</span> <em>24 possible glove outcomes</em> — Hedge Maze +$4,631, Pandora\'s Box +$4,116', oc0);
        oc0.classList.add('mdemo-ocard-hl');
        await sleep(3500); if (!runningRef.current) return;
        oc0.classList.remove('mdemo-ocard-hl');
        hideTip();

        // Step 2: Verify — scroll up
        if (cardsEl) await scrollCards(cardsEl, vb);
        await sleep(200);
        await moveTo(vb);
        showTip('<span class="mdemo-step-num">2</span> <em>Verify</em> all listings are still available before buying', vb);
        await sleep(500); await click();
        vb.textContent = 'Checking...';
        vb.className = 'mdemo-verify mdemo-verify-checking';
        await sleep(1500);
        vb.textContent = 'All listed \u2713';
        vb.className = 'mdemo-verify mdemo-verify-done';
        await sleep(2000); if (!runningRef.current) return;
        hideTip();

        // Step 3: Claim
        if (cardsEl) await scrollCards(cardsEl, claimBar);
        await sleep(200);
        await moveTo(cb);
        showTip('<span class="mdemo-step-num">3</span> <em>Claim</em> to lock all 5 listings for 30 min — nobody else can take them', cb);
        await sleep(1500); await click();
        cb.style.display = 'none';
        ct.innerHTML = '<span style="color:#c084fc;font-weight:500">You claimed this trade-up</span>';
        ca.style.display = 'flex';
        await sleep(2500); if (!runningRef.current) return;
        hideTip();

        // Step 4: Purchase
        if (cardsEl) await scrollCards(cardsEl, inp0);
        await sleep(200);
        await moveTo(inp0);
        showTip('<span class="mdemo-step-num">4</span> <em>Purchase</em> — tap any input to go to the marketplace listing', inp0);
        await sleep(2000); await click();
        await sleep(500); hideTip();

        await moveTo(inp2);
        showTip('<span class="mdemo-step-num">4</span> Buy all 5 inputs on <em>DMarket</em> and <em>CSFloat</em> — total: <em>$1,466.87</em>', inp2);
        await sleep(3000); if (!runningRef.current) return;
        hideTip();

        // Step 5: Confirm
        if (cardsEl) await scrollCards(cardsEl, claimBar);
        await sleep(200);
        await moveTo(confBtn);
        showTip('<span class="mdemo-step-num">5</span> <em>Confirm purchase</em> and complete your trade-up — good luck!', confBtn);
        await sleep(3500); if (!runningRef.current) return;
        hideTip();

        // Reset
        await sleep(1500);
        exp0.style.display = 'none';
        arrow0.textContent = '▶';
        card0.classList.remove('mdemo-card-hl');
        cb.style.display = '';
        cb.textContent = 'Claim (8/10)';
        cb.className = 'mdemo-claim-btn';
        ca.style.display = 'none';
        ct.textContent = 'Claim to lock listings for 30 min';
        vb.textContent = 'Verify (20/20)';
        vb.className = 'mdemo-verify';
        knifePill.className = 'mdemo-tpill';
        allPill.className = 'mdemo-tpill mdemo-tpill-active';
        statline.innerHTML = '592,938 found (<span class="mdemo-green">28,493 profitable</span>)';
        if (cardsEl) cardsEl.scrollTop = 0;
        const cur = cursorRef.current!;
        cur.style.transitionDuration = '400ms';
        cur.style.left = '195px';
        cur.style.top = '350px';
        await sleep(2500);
      }
    }

    demo();
    return () => { runningRef.current = false; };
  }, [moveTo, click, showTip, hideTip, scrollCards]);

  return (
    <div className="flex justify-center">
      <div className="relative rounded-[40px] border-[3px] border-[#2a2a2a] overflow-hidden shadow-[0_0_0_1px_#000,0_20px_60px_rgba(0,0,0,.6)]" style={{ width: 390, height: 700 }}>
        {/* Notch */}
        <div className="absolute top-2 left-1/2 -translate-x-1/2 w-[100px] h-6 bg-[#1a1a1a] rounded-[14px] z-[200]" />

        <div ref={screenRef} className="absolute inset-0 overflow-hidden pt-10 bg-[#111]">
          <style>{`
            .mdemo-cursor{position:absolute;width:18px;height:18px;pointer-events:none;z-index:100;transition:left .7s cubic-bezier(.4,0,.2,1),top .7s cubic-bezier(.4,0,.2,1);left:195px;top:350px}
            .mdemo-cursor svg{filter:drop-shadow(0 2px 4px rgba(0,0,0,.6))}
            .mdemo-ring{position:absolute;width:24px;height:24px;border-radius:50%;border:2px solid #22c55e;opacity:0;pointer-events:none;z-index:99}
            .mdemo-pop{animation:mdemoPop .5s ease-out}
            @keyframes mdemoPop{0%{opacity:.7;transform:scale(0)}100%{opacity:0;transform:scale(2)}}
            .mdemo-tip{position:absolute;background:#161616;border:1px solid rgba(34,197,94,.2);border-radius:8px;padding:8px 12px;color:#d4d4d4;font-size:11px;line-height:1.4;max-width:320px;opacity:0;transition:opacity .4s;z-index:90;pointer-events:none}
            .mdemo-tip em{color:#22c55e;font-style:normal;font-weight:600}
            .mdemo-step-num{display:inline-block;background:#22c55e;color:#000;font-weight:700;font-size:9px;width:16px;height:16px;border-radius:50%;text-align:center;line-height:16px;margin-right:5px}
            .mdemo-tpill{font-size:11px;padding:4px 12px;border-radius:999px;border:1px solid transparent;color:#737373;font-weight:500;white-space:nowrap;flex-shrink:0}
            .mdemo-tpill-active{border-color:rgba(229,229,229,.25);background:rgba(229,229,229,.06);color:#e5e5e5}
            .mdemo-tpill-knife{border-color:rgba(234,179,8,.4);background:rgba(234,179,8,.1);color:#eab308;font-weight:600}
            .mdemo-green{color:#22c55e}
            .mdemo-card{background:#161616;border:1px solid #222;border-radius:10px;overflow:hidden;transition:all .25s}
            .mdemo-card-hl{border-color:#333;background:#1a1a1a}
            .mdemo-claim-bar{display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:rgba(34,197,94,.03);border-bottom:1px solid rgba(34,197,94,.12)}
            .mdemo-claim-text{font-size:10px;color:#86efac;line-height:1.3}
            .mdemo-claim-btn{padding:4px 12px;font-size:10px;font-weight:600;border-radius:6px;border:1px solid rgba(168,85,247,.5);background:rgba(88,28,135,.3);color:#c084fc;cursor:pointer}
            .mdemo-claim-actions{display:none;gap:5px;align-items:center}
            .mdemo-confirm-btn{padding:3px 10px;font-size:9px;font-weight:600;border-radius:5px;border:1px solid rgba(34,197,94,.5);background:rgba(20,83,45,.3);color:#4ade80}
            .mdemo-release-btn{padding:3px 10px;font-size:9px;font-weight:500;border-radius:5px;border:1px solid #333;background:transparent;color:#a3a3a3}
            .mdemo-verify{padding:3px 10px;font-size:9px;font-weight:600;border-radius:5px;border:1px solid #262626;background:#1a1a1a;color:#60a5fa;margin-left:6px}
            .mdemo-verify-checking{color:#fbbf24;border-color:rgba(245,158,11,.3)}
            .mdemo-verify-done{color:#4ade80;border-color:rgba(34,197,94,.3)}
            .mdemo-ocard{background:rgba(163,163,163,.04);border:1px solid rgba(255,255,255,.06);border-radius:6px;padding:6px 8px;transition:all .25s}
            .mdemo-ocard-hl{border-color:rgba(34,197,94,.3)!important;background:rgba(34,197,94,.04)!important}
            .mdemo-icard{background:rgba(163,163,163,.04);border:1px solid rgba(255,255,255,.06);border-radius:6px;padding:5px 7px}
            .mdemo-src{display:inline-block;font-size:6px;font-weight:700;padding:0 3px;border-radius:2px;color:#fff;margin-right:2px;vertical-align:middle}
            .mdemo-src-dm{background:#4f8cff}
            .mdemo-src-cs{background:#6366f1}
            .mdemo-pos{color:#22c55e;font-weight:600}
            .mdemo-neg{color:#ef4444;font-weight:600}
            .mdemo-bar{border-radius:2px 2px 0 0;flex:1;position:relative;min-width:6px}
            .mdemo-bar-loss{background:rgba(127,29,29,.6);border:1px solid rgba(153,27,27,.4);border-bottom:0}
            .mdemo-bar-win{background:rgba(20,83,45,.6);border:1px solid rgba(22,101,52,.4);border-bottom:0}
            .mdemo-bar .pct{position:absolute;top:0;left:50%;transform:translateX(-50%);font-size:7px;color:rgba(229,229,229,.5);white-space:nowrap}
            .mdemo-spill{font-size:11px;padding:3px 10px;border-radius:999px;border:1px solid transparent;color:#737373;white-space:nowrap;flex-shrink:0}
            .mdemo-spill-active{border-color:rgba(229,229,229,.3);background:rgba(229,229,229,.1);color:#e5e5e5;font-weight:500}
          `}</style>

          {/* Cursor */}
          <div ref={cursorRef} className="mdemo-cursor">
            <svg width="18" height="18" viewBox="0 0 24 24"><path d="M5.5 3.21V20.8c0 .45.54.67.85.35l4.86-4.86a.5.5 0 0 1 .35-.15h6.87a.5.5 0 0 0 .35-.85L6.35 2.86a.5.5 0 0 0-.85.35z" fill="#fff" stroke="#000" strokeWidth="1"/></svg>
          </div>
          <div ref={ringRef} className="mdemo-ring" />
          <div ref={tipRef} className="mdemo-tip" />

          {/* Header */}
          <div className="flex items-center justify-between px-4 py-2 border-b border-[#1a1a1a]">
            <div className="text-sm font-bold text-[#e5e5e5] tracking-tight">Trade<span className="text-green-500">Up</span>Bot</div>
            <div className="flex items-center gap-2">
              <span className="text-[9px] px-2 py-0.5 rounded-full bg-green-500/10 border border-green-500/30 text-green-500 font-semibold">PRO</span>
              <div className="w-6 h-6 rounded-full bg-[#262626] border border-[#333]" />
            </div>
          </div>

          {/* Type pills */}
          <div className="flex gap-[5px] px-4 py-2 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
            <div data-mpill="all" className="mdemo-tpill mdemo-tpill-active">All</div>
            <div data-mpill="knife" className="mdemo-tpill">Knife/Gloves</div>
            <div className="mdemo-tpill">Covert</div>
            <div className="mdemo-tpill">Classified</div>
            <div className="mdemo-tpill">Restricted</div>
            <div className="mdemo-tpill">Mil-Spec</div>
          </div>

          {/* Sort pills */}
          <div className="flex items-center gap-[5px] px-4 py-1 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
            <span className="text-[11px] text-[#525252] flex-shrink-0">Sort:</span>
            <div className="mdemo-spill mdemo-spill-active">Profit ↓</div>
            <div className="mdemo-spill">ROI</div>
            <div className="mdemo-spill">Chance</div>
            <div className="mdemo-spill">Cost</div>
            <div className="mdemo-spill">EV</div>
            <div className="mdemo-spill">Best</div>
          </div>

          {/* Stats */}
          <div data-mstats className="px-4 py-1 text-[10px] text-[#525252]">592,938 found (<span className="mdemo-green">28,493 profitable</span>)</div>

          {/* Cards */}
          <div data-cards className="px-3 flex flex-col gap-2 overflow-y-auto" style={{ maxHeight: 'calc(100% - 152px)', scrollbarWidth: 'none' }}>
            {/* Card 0 — interactive */}
            <div data-card="0" className="mdemo-card">
              <div className="px-3 pt-2.5 pb-1">
                <div className="flex items-start justify-between gap-1.5">
                  <div className="text-[12.5px] text-white/60 leading-snug"><a>4x M4A4 | Buzz Kill</a>, <a>1x SSG 08 | Dragonfire</a></div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <span className="text-[8px] text-white/25">(2h)</span>
                    <span data-marrow className="text-[10px] text-white/20">▶</span>
                  </div>
                </div>
                <div className="flex gap-1 mt-1"><span className="inline-block text-[8.5px] px-[5px] py-px rounded-[3px] bg-[#1e293b] text-[#94a3b8] border border-[#334155]">Glove</span></div>
              </div>
              <div className="px-3 pb-2.5 flex items-center gap-2 flex-wrap">
                <span data-mprofit className="text-[15px] font-bold mdemo-pos">$306.42</span>
                <span className="text-[11px] px-[7px] py-0.5 rounded bg-green-500/15 text-green-500 font-semibold">20.9%</span>
                <span className="text-[11px] px-[7px] py-0.5 rounded bg-amber-500/15 text-amber-400 font-semibold">46%</span>
                <span className="text-[11px] text-[#737373] ml-auto">$1,466.87 cost</span>
              </div>

              {/* Expanded content */}
              <div data-mexpanded style={{ display: 'none' }} className="border-t border-[#1f1f1f] bg-[#111]">
                {/* Claim bar */}
                <div data-mclaim-bar className="mdemo-claim-bar">
                  <span className="mdemo-claim-text" data-mclaim-text>Claim to lock listings for 30 min</span>
                  <div className="flex gap-[5px] items-center">
                    <button className="mdemo-claim-btn" data-mclaim>Claim (8/10)</button>
                    <div data-mclaim-actions style={{ display: 'none', gap: 5 }} className="items-center">
                      <button className="mdemo-confirm-btn" data-mconfirm>Confirm Purchase</button>
                      <button className="mdemo-release-btn">Release</button>
                    </div>
                  </div>
                </div>

                {/* Distribution */}
                <div className="px-3 py-2.5">
                  <div className="flex justify-between mb-1">
                    <span className="text-[10px] text-[#737373] uppercase tracking-wide">Outcome Distribution</span>
                    <span className="text-[9px] text-[#525252]">$1000 bins</span>
                  </div>
                  <div className="h-[55px] flex items-end gap-0.5 border-b border-[#262626] mb-0.5">
                    <div className="mdemo-bar mdemo-bar-loss" style={{ height: '48%' }}><span className="pct">16.7%</span></div>
                    <div className="mdemo-bar mdemo-bar-loss" style={{ height: '48%' }}><span className="pct">16.7%</span></div>
                    <div className="mdemo-bar mdemo-bar-loss" style={{ height: '60%' }}><span className="pct">20.8%</span></div>
                    <div className="mdemo-bar mdemo-bar-win" style={{ height: '48%' }}><span className="pct">16.7%</span></div>
                    <div className="mdemo-bar mdemo-bar-win" style={{ height: '48%' }}><span className="pct">16.7%</span></div>
                    <div className="mdemo-bar mdemo-bar-win" style={{ height: '36%' }}><span className="pct">12.5%</span></div>
                  </div>
                  <div className="flex justify-between text-[7px] mb-px">
                    <span className="text-red-600/50">-$1,256</span><span className="text-red-600/50">-$500</span><span className="text-[#525252]">Loss | Profit</span><span className="text-green-600/50">$2,000</span><span className="text-green-600/50">$4,631</span>
                  </div>
                  <div className="flex justify-between text-[9px] text-[#525252] mt-[3px]">
                    <span>EV: <strong className="text-green-500">$306.42</strong></span><span>24 outcomes in 6 bins</span>
                  </div>
                </div>

                {/* Inputs */}
                <div className="text-[10px] text-[#737373] uppercase tracking-wide px-3 mt-2 mb-1.5">Inputs (5) <span className="mdemo-verify" data-mverify>Verify (20/20)</span></div>
                <div className="grid grid-cols-2 gap-1 px-3">
                  {[
                    { src: 'dm', name: 'M4A4 | Buzz Kill', fl: 'FT 0.2484', pr: '$292.00', idx: 0 },
                    { src: 'dm', name: 'M4A4 | Buzz Kill', fl: 'FT 0.2194', pr: '$292.00', idx: 1 },
                    { src: 'dm', name: 'M4A4 | Buzz Kill', fl: 'FT 0.1825', pr: '$293.93', idx: 2 },
                    { src: 'dm', name: 'M4A4 | Buzz Kill', fl: 'FT 0.3395', pr: '$293.94', idx: 3 },
                  ].map((inp) => (
                    <div key={inp.idx} className="mdemo-icard" data-minput={inp.idx}>
                      <div className="text-[9px] text-[#d4d4d4] font-medium whitespace-nowrap overflow-hidden text-ellipsis">
                        <span className={`mdemo-src mdemo-src-${inp.src}`}>{inp.src === 'dm' ? 'DM' : 'CS'}</span>
                        <a>{inp.name}</a> <span className="text-[7px] font-semibold text-green-500 float-right">✓</span>
                      </div>
                      <div className="text-[8px] text-[#737373] mt-px">{inp.fl}</div>
                      <div className="text-[9px] text-white/80 font-semibold mt-px">{inp.pr}</div>
                    </div>
                  ))}
                  {/* 5th input spans full width */}
                  <div className="mdemo-icard col-span-2" data-minput="4">
                    <div className="text-[9px] text-[#d4d4d4] font-medium whitespace-nowrap overflow-hidden text-ellipsis">
                      <span className="mdemo-src mdemo-src-cs">CS</span>
                      <a>SSG 08 | Dragonfire</a> <span className="text-[7px] font-semibold text-green-500 float-right">✓</span>
                    </div>
                    <div className="text-[8px] text-[#737373] mt-px">FT 0.1513</div>
                    <div className="text-[9px] text-white/80 font-semibold mt-px">$295.00</div>
                  </div>
                </div>

                {/* Outcomes */}
                <div className="text-[10px] text-[#737373] uppercase tracking-wide px-3 mt-2.5 mb-1.5">Possible Outcomes (24)</div>
                <div className="flex flex-col gap-1 px-3 pb-3">
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
                    <div key={i} className="mdemo-ocard" {...(i === 0 ? { 'data-moutcome': '0' } : {})}>
                      <div className="flex justify-between items-baseline"><span className="text-[10px] text-[#d4d4d4] font-medium">{o.name}</span><span className="text-[9px] text-blue-400 font-semibold">{o.prob}</span></div>
                      <div className="flex justify-between items-baseline mt-0.5"><span className="text-[8px] text-[#737373]">{o.fl}</span><span className={`text-[10px] font-semibold ${o.pos ? 'mdemo-pos' : 'mdemo-neg'}`}>{o.delta}</span></div>
                      <div className="text-[7px] text-[#737373]/50 mt-0.5">{o.data}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Other cards */}
            {[
              { inputs: '3x M4A4 | Buzz Kill, 2x SSG 08 | Dragonfire', profit: '$298.43', roi: '20.4%', chance: '46%', cost: '$1,464.38', age: '2h' },
              { inputs: '5x M4A4 | Buzz Kill', profit: '$296.58', roi: '20.3%', chance: '46%', cost: '$1,463.87', age: '1h' },
              { inputs: '5x M4A4 | Buzz Kill', profit: '$296.03', roi: '20.2%', chance: '46%', cost: '$1,463.87', age: '1h' },
              { inputs: '3x M4A4 | Buzz Kill, 2x SSG 08 | Dragonfire', profit: '$295.73', roi: '20.2%', chance: '42%', cost: '$1,464.38', age: '3h' },
            ].map((c, i) => (
              <div key={i} className="mdemo-card">
                <div className="px-3 pt-2.5 pb-1">
                  <div className="flex items-start justify-between gap-1.5">
                    <div className="text-[12.5px] text-white/60 leading-snug"><a>{c.inputs}</a></div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <span className="text-[8px] text-white/25">({c.age})</span>
                      <span className="text-[10px] text-white/20">▶</span>
                    </div>
                  </div>
                  <div className="flex gap-1 mt-1"><span className="inline-block text-[8.5px] px-[5px] py-px rounded-[3px] bg-[#1e293b] text-[#94a3b8] border border-[#334155]">Glove</span></div>
                </div>
                <div className="px-3 pb-2.5 flex items-center gap-2 flex-wrap">
                  <span className="text-[15px] font-bold mdemo-pos">{c.profit}</span>
                  <span className="text-[11px] px-[7px] py-0.5 rounded bg-green-500/15 text-green-500 font-semibold">{c.roi}</span>
                  <span className="text-[11px] px-[7px] py-0.5 rounded bg-amber-500/15 text-amber-400 font-semibold">{c.chance}</span>
                  <span className="text-[11px] text-[#737373] ml-auto">{c.cost} cost</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
