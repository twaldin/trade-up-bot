/**
 * Ledger laptop — copied from dashboard-saas `src/systems/ledger/laptop.tsx`.
 * Geometry is `docs/device-frames.md` §3.1. Screen faces the reader; base is 90°.
 * Between `.lg-scene` and the deepest 3D transform: no clip / blur / fade / mask.
 */
import * as React from "react";
import { useInView, usePointerTilt, usePrefersReducedMotion } from "../lib/motion.js";
import "../ledger/laptop.css";

const LID_MS = 900;

export function Laptop({
  children,
  chin = "TradeUpBot",
}: {
  children: React.ReactNode;
  chin?: string;
}) {
  const reduced = usePrefersReducedMotion();
  const [frameRef, inView] = useInView<HTMLDivElement>({ threshold: 0.3, once: true });
  const sceneRef = usePointerTilt<HTMLDivElement>({ damping: 0.1 });
  const screenRef = React.useRef<HTMLDivElement>(null);
  const [settled, setSettled] = React.useState(false);

  const open = reduced || inView;

  React.useEffect(() => {
    if (screenRef.current) screenRef.current.inert = true;
  }, []);

  React.useEffect(() => {
    if (reduced) {
      setSettled(true);
      return;
    }
    if (!inView) return;
    const handle = window.setTimeout(() => setSettled(true), LID_MS + 60);
    return () => window.clearTimeout(handle);
  }, [inView, reduced]);

  return (
    <div ref={frameRef} className="lg-port">
      <div className="lg-scene" ref={sceneRef} data-open={open ? "1" : "0"} data-settle={settled ? "1" : "0"}>
        <div className="lg-laptop" aria-hidden="true">
          <div className="lg-lid">
            <div className="lg-lid-back" />
            <div className="lg-lid-front">
              <div className="lg-notch" />
              <div className="lg-screen">
                <div className="lg-screen-surface" ref={screenRef}>
                  {children}
                </div>
                <div className="lg-glare" />
                <div className="lg-glass" />
              </div>
              <div className="lg-chin">
                <span>{chin}</span>
              </div>
            </div>
          </div>
          <div className="lg-base">
            <div className="lg-deck">
              <div className="lg-keys">
                {Array.from({ length: 70 }, (_, i) => (
                  <i key={i} />
                ))}
              </div>
              <div className="lg-trackpad" />
            </div>
            <div className="lg-wall lg-wall--front" />
            <div className="lg-wall lg-wall--left" />
            <div className="lg-wall lg-wall--right" />
          </div>
          <div className="lg-contact" />
        </div>
      </div>
    </div>
  );
}
