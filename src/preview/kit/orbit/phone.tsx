/**
 * Orbit phone frame — same device contract as dashboard-saas Orbit laptop:
 * pointer-tilt camera, aria-hidden chassis, inert screen (Recharts maths).
 */
import * as React from "react";
import { usePointerTilt } from "../lib/motion.js";
import "./phone.css";

export function Phone({ children }: { children: React.ReactNode }) {
  const sceneRef = usePointerTilt<HTMLDivElement>({ damping: 0.1 });
  const screenRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (screenRef.current) screenRef.current.inert = true;
  }, []);

  return (
    <div className="o-phone-port">
      <div className="o-phone-scene" ref={sceneRef}>
        <div className="o-phone" aria-hidden="true">
          <div className="o-phone__shell" />
          <div className="o-phone__island" />
          <div className="o-phone__screen">
            <div className="o-phone__surface" ref={screenRef}>
              {children}
            </div>
            <div className="o-phone__glare" />
            <div className="o-phone__glass" />
          </div>
          <div className="o-phone__btn" />
          <div className="o-phone__shadow" />
        </div>
      </div>
    </div>
  );
}
