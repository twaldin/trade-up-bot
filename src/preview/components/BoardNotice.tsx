import { RotateCw, X } from "lucide-react";
import {
  FILTERED_EMPTY_COPY,
  LOAD_ERROR_COPY,
  UNFILTERED_EMPTY_COPY,
  type BoardNoticeKind,
} from "../lib/board-notice.js";
import { SLOW_DOWN_COPY } from "../lib/page-fetch.js";

export function BoardNotice({
  notice,
  onClearFilters,
  onRetry,
}: {
  notice: BoardNoticeKind | null;
  onClearFilters?: () => void;
  onRetry?: () => void;
}) {
  switch (notice) {
    case "throttled":
      return <p className="preview-note" role="status">{SLOW_DOWN_COPY}</p>;
    case "error":
      return (
        <div className="preview-notice" role="alert">
          <p className="preview-note">{LOAD_ERROR_COPY}</p>
          {onRetry && (
            <button type="button" className="preview-btn preview-btn--quiet" onClick={onRetry}>
              <RotateCw size={11} aria-hidden />
              Retry
            </button>
          )}
        </div>
      );
    case "filtered-empty":
      return (
        <div className="preview-notice" role="status">
          <p className="preview-note">{FILTERED_EMPTY_COPY}</p>
          {onClearFilters && (
            <button type="button" className="preview-btn preview-btn--quiet" onClick={onClearFilters}>
              <X size={11} aria-hidden />
              Clear filters
            </button>
          )}
        </div>
      );
    case "empty":
      return <p className="preview-note" role="status">{UNFILTERED_EMPTY_COPY}</p>;
    default:
      return null;
  }
}
