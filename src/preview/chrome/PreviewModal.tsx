import type { ReactNode } from "react";

export function PreviewModal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="pv-modal-back" role="dialog" aria-modal="true" aria-label={title} onClick={onClose}>
      <div className="pv-modal" onClick={e => e.stopPropagation()}>
        <div className="pv-kicker">Preview</div>
        <h2 style={{ margin: "8px 0 12px", fontSize: 20, letterSpacing: "-0.03em" }}>{title}</h2>
        {children}
        <div style={{ marginTop: 16, display: "flex", justifyContent: "flex-end" }}>
          <button type="button" className="pv-btn pv-btn-ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
