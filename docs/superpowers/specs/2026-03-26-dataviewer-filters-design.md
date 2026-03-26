# Dataviewer Scatter Chart Filters

**Date:** 2026-03-26
**Status:** Approved
**Branch:** coder/dataviewer-filters

## Summary

Add float range and time range filters to the dataviewer scatter chart. Both filters apply client-side to all data series (listings, sales, float buckets) and auto-rescale the chart axes to fit filtered data.

## Filter State

State lives in `SkinDetailPanel` alongside existing `visible` and `sourceFilters`:

```typescript
floatRange: { min: number | null; max: number | null }
timeRange: { from: Date | null; to: Date | null }
```

`null` means "any" (no bound). Both default to all-null (show everything).

## Data Flow

A single `useMemo` in `SkinDetailPanel` produces filtered arrays:

- **Float filter** — listings/sales filtered by `float_value`. Float buckets filtered by overlap: `bucket.float_max >= filter.min && bucket.float_min <= filter.max`.
- **Time filter** — listings filtered by `created_at`, sales by `sold_at`. Float buckets **hidden entirely** when any time filter is active (they're pre-computed aggregates with no timestamp).
- When time filter active, `visible.buckets` forced false and bucket legend item dimmed/disabled.

Filtered arrays flow to:
- `ScatterChart` (auto-rescales via existing p95 logic — no chart changes needed)
- Listings table
- Sale History table
- Legend counts (show filtered count, not total)

## FilterBar Component

New file: `src/components/data-viewer/FilterBar.tsx`

Rendered inline between phase tabs and the scatter chart. Two compact rows matching existing styling (text-xs, muted labels).

### Row 1 — Float Range

- **Condition dropdown** (shadcn Select): options are 'Any' plus conditions whose float range overlaps the skin's `[min_float, max_float]`. Conditions outside the skin's range are omitted.
  - Factory New: 0–0.07
  - Minimal Wear: 0.07–0.15
  - Field-Tested: 0.15–0.38
  - Well-Worn: 0.38–0.45
  - Battle-Scarred: 0.45–1.0
- Selecting a condition auto-fills min/max inputs with that condition's float range.
- **Two number inputs** (min/max float) for custom range, editable after condition select.
- Editing custom values switches dropdown to 'Custom'.
- **Clear button** resets float filter to null/null.

### Row 2 — Time Range

- **Two shadcn DatePicker components** (from/to) built on react-day-picker + Calendar + Popover.
- **Quick preset buttons**: '7d', '30d', '90d', 'All'.
  - Presets set `from` to a calculated date and `to` to null (meaning "now").
  - 'All' clears time filter entirely.
  - Active preset visually highlighted.

### Props

```typescript
interface FilterBarProps {
  floatRange: { min: number | null; max: number | null };
  timeRange: { from: Date | null; to: Date | null };
  onFloatRangeChange: (range: { min: number | null; max: number | null }) => void;
  onTimeRangeChange: (range: { from: Date | null; to: Date | null }) => void;
  skinMinFloat: number;
  skinMaxFloat: number;
}
```

## Dependencies

- `react-day-picker` and `date-fns` — required by shadcn Calendar/DatePicker.
- Install via: `npx shadcn@latest add calendar popover` (popover may already exist).

## Files Changed

| File | Change |
|------|--------|
| `src/components/data-viewer/FilterBar.tsx` | New — filter bar component |
| `src/components/data-viewer/SkinDetailPanel.tsx` | Add filter state, useMemo for filtering, render FilterBar, pass filtered data |
| `src/components/data-viewer/types.ts` | Add FilterBarProps interface |
| `package.json` | Add react-day-picker, date-fns (via shadcn) |

## What Does NOT Change

- `ScatterChart.tsx` — receives filtered data, auto-rescales as-is.
- Backend API routes — all filtering is client-side.
- Database schema — no changes.
