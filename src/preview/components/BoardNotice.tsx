import { RotateCw, X } from "lucide-react";
import {
  FILTERED_EMPTY_COPY,
  LOAD_ERROR_COPY,
  UNFILTERED_EMPTY_COPY,
  type BoardNoticeKind,
} from "../lib/board-notice.js";
import { RATE_LIMIT_MANUAL_COPY } from "../lib/page-fetch.js";

export function BoardNotice({
  notice,
  onClearFilters,
  onRetry,
  suggestion,
  onApplySuggestion,
  detail,
  message,
}: {
  notice: BoardNoticeKind | null;
  onClearFilters?: () => void;
  onRetry?: () => void;
  suggestion?: { label: string } | null;
  onApplySuggestion?: () => void;
  /** Extra sentence when the rows on screen are from the previous request. */
  detail?: string;
  /** List throttle copy. Card throttles never auto-retry, so they use the manual line. */
  message?: string;
}) {
  const throttleCopy = message || RATE_LIMIT_MANUAL_COPY;
  switch (notice) {
    case "throttled":
      return (
        <div className="preview-notice" role="status">
          <p className="preview-note">{detail ? `${throttleCopy} ${detail}` : throttleCopy}</p>
          {onRetry && (
            <button type="button" className="preview-btn preview-btn--quiet" onClick={onRetry}>
              <RotateCw size={11} aria-hidden />
              Retry
            </button>
          )}
        </div>
      );
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
          {suggestion && onApplySuggestion && (
            <button type="button" className="preview-btn preview-btn--quiet" onClick={onApplySuggestion}>
              {suggestion.label}
            </button>
          )}
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
