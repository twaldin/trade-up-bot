# Dataviewer Filters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add float range and time range filters to the dataviewer scatter chart, filtering all data series client-side with auto-rescaling axes.

**Architecture:** Filter state in SkinDetailPanel, filtered data flows to ScatterChart and tables via useMemo. New FilterBar component renders inline between phase tabs and chart. shadcn DatePicker (calendar + popover) for date inputs.

**Tech Stack:** React, shadcn/ui (Calendar, Popover, Select, Button, Input), react-day-picker, date-fns, Vitest

---

### Task 1: Install shadcn Calendar and Popover components

**Files:**
- Modify: `package.json` (new deps: react-day-picker, date-fns)
- Create: `shared/components/ui/calendar.tsx` (via shadcn CLI)
- Create: `shared/components/ui/popover.tsx` (via shadcn CLI)
- Create: `shared/components/ui/select.tsx` (via shadcn CLI)

- [ ] **Step 1: Install shadcn components**

```bash
cd /private/tmp/claudecord-wt-dataviewer
npx shadcn@latest add calendar popover select --yes
```

This installs `react-day-picker` and `date-fns` as dependencies and generates the Calendar, Popover, and Select components into `shared/components/ui/`.

- [ ] **Step 2: Verify components exist**

```bash
ls shared/components/ui/calendar.tsx shared/components/ui/popover.tsx shared/components/ui/select.tsx
```

Expected: all three files listed.

- [ ] **Step 3: Verify build passes**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add shared/components/ui/calendar.tsx shared/components/ui/popover.tsx shared/components/ui/select.tsx package.json package-lock.json
git commit -m "deps: add shadcn calendar, popover, select for dataviewer filters"
```

---

### Task 2: Write filter utility functions and tests

**Files:**
- Create: `src/components/data-viewer/filter-utils.ts`
- Create: `tests/unit/dataviewer-filters.test.ts`

These are pure functions with no React dependency — easy to test.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/dataviewer-filters.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  filterByFloatRange,
  filterByTimeRange,
  filterBucketsByFloatRange,
  getAvailableConditions,
  CONDITION_RANGES,
} from "../../src/components/data-viewer/filter-utils.js";

// ─── CONDITION_RANGES ────────────────────────────────────────────────────────

describe("CONDITION_RANGES", () => {
  it("covers all five conditions", () => {
    expect(Object.keys(CONDITION_RANGES)).toEqual([
      "Factory New", "Minimal Wear", "Field-Tested", "Well-Worn", "Battle-Scarred",
    ]);
  });

  it("Factory New is 0–0.07", () => {
    expect(CONDITION_RANGES["Factory New"]).toEqual({ min: 0, max: 0.07 });
  });

  it("Battle-Scarred is 0.45–1.0", () => {
    expect(CONDITION_RANGES["Battle-Scarred"]).toEqual({ min: 0.45, max: 1 });
  });
});

// ─── getAvailableConditions ──────────────────────────────────────────────────

describe("getAvailableConditions", () => {
  it("returns only conditions that overlap the skin's float range", () => {
    // Skin with range 0.06–0.80 — overlaps all conditions
    const result = getAvailableConditions(0.06, 0.80);
    expect(result.map(c => c.name)).toEqual([
      "Factory New", "Minimal Wear", "Field-Tested", "Well-Worn", "Battle-Scarred",
    ]);
  });

  it("excludes FN for a skin with min_float 0.08", () => {
    const result = getAvailableConditions(0.08, 1.0);
    expect(result.map(c => c.name)).not.toContain("Factory New");
  });

  it("excludes BS and WW for a skin with max_float 0.38", () => {
    const result = getAvailableConditions(0.0, 0.38);
    expect(result.map(c => c.name)).not.toContain("Battle-Scarred");
    expect(result.map(c => c.name)).not.toContain("Well-Worn");
    // FT boundary is 0.15–0.38, and max_float 0.38 overlaps
    expect(result.map(c => c.name)).toContain("Field-Tested");
  });

  it("returns only FT for a skin with range 0.15–0.38", () => {
    const result = getAvailableConditions(0.15, 0.38);
    expect(result.map(c => c.name)).toEqual(["Field-Tested"]);
  });
});

// ─── filterByFloatRange ──────────────────────────────────────────────────────

describe("filterByFloatRange", () => {
  const items = [
    { float_value: 0.01 },
    { float_value: 0.10 },
    { float_value: 0.25 },
    { float_value: 0.50 },
    { float_value: 0.90 },
  ];

  it("returns all items when both bounds are null", () => {
    expect(filterByFloatRange(items, null, null)).toHaveLength(5);
  });

  it("filters by min only", () => {
    const result = filterByFloatRange(items, 0.20, null);
    expect(result.map(i => i.float_value)).toEqual([0.25, 0.50, 0.90]);
  });

  it("filters by max only", () => {
    const result = filterByFloatRange(items, null, 0.30);
    expect(result.map(i => i.float_value)).toEqual([0.01, 0.10, 0.25]);
  });

  it("filters by both min and max", () => {
    const result = filterByFloatRange(items, 0.05, 0.30);
    expect(result.map(i => i.float_value)).toEqual([0.10, 0.25]);
  });

  it("inclusive on both boundaries", () => {
    const result = filterByFloatRange(items, 0.10, 0.50);
    expect(result.map(i => i.float_value)).toEqual([0.10, 0.25, 0.50]);
  });

  it("returns empty array when range excludes all", () => {
    expect(filterByFloatRange(items, 0.95, 0.99)).toHaveLength(0);
  });
});

// ─── filterByTimeRange ───────────────────────────────────────────────────────

describe("filterByTimeRange", () => {
  const items = [
    { dateField: "2026-03-01T00:00:00Z" },
    { dateField: "2026-03-10T00:00:00Z" },
    { dateField: "2026-03-20T00:00:00Z" },
    { dateField: "2026-03-25T00:00:00Z" },
  ];

  it("returns all items when both bounds are null", () => {
    expect(filterByTimeRange(items, "dateField", null, null)).toHaveLength(4);
  });

  it("filters by from date", () => {
    const from = new Date("2026-03-15T00:00:00Z");
    const result = filterByTimeRange(items, "dateField", from, null);
    expect(result).toHaveLength(2);
    expect(result[0].dateField).toBe("2026-03-20T00:00:00Z");
  });

  it("filters by to date", () => {
    const to = new Date("2026-03-15T00:00:00Z");
    const result = filterByTimeRange(items, "dateField", null, to);
    expect(result).toHaveLength(2);
    expect(result[0].dateField).toBe("2026-03-01T00:00:00Z");
  });

  it("filters by both from and to", () => {
    const from = new Date("2026-03-05T00:00:00Z");
    const to = new Date("2026-03-22T00:00:00Z");
    const result = filterByTimeRange(items, "dateField", from, to);
    expect(result).toHaveLength(2);
  });
});

// ─── filterBucketsByFloatRange ───────────────────────────────────────────────

describe("filterBucketsByFloatRange", () => {
  const buckets = [
    { float_min: 0.00, float_max: 0.07, avg_price_cents: 1000, listing_count: 5 },
    { float_min: 0.07, float_max: 0.15, avg_price_cents: 800, listing_count: 10 },
    { float_min: 0.15, float_max: 0.38, avg_price_cents: 500, listing_count: 20 },
    { float_min: 0.38, float_max: 0.45, avg_price_cents: 300, listing_count: 8 },
    { float_min: 0.45, float_max: 1.00, avg_price_cents: 200, listing_count: 15 },
  ];

  it("returns all buckets when both bounds are null", () => {
    expect(filterBucketsByFloatRange(buckets, null, null)).toHaveLength(5);
  });

  it("uses overlap check — partial overlap is included", () => {
    // Filter 0.10–0.20 overlaps MW (0.07–0.15) and FT (0.15–0.38)
    const result = filterBucketsByFloatRange(buckets, 0.10, 0.20);
    expect(result).toHaveLength(2);
    expect(result[0].float_min).toBe(0.07);
    expect(result[1].float_min).toBe(0.15);
  });

  it("excludes buckets with no overlap", () => {
    // Filter 0.50–0.80 only overlaps BS (0.45–1.00)
    const result = filterBucketsByFloatRange(buckets, 0.50, 0.80);
    expect(result).toHaveLength(1);
    expect(result[0].float_min).toBe(0.45);
  });

  it("min-only filter", () => {
    const result = filterBucketsByFloatRange(buckets, 0.40, null);
    expect(result).toHaveLength(2); // WW (0.38–0.45) overlaps, BS overlaps
  });

  it("max-only filter", () => {
    const result = filterBucketsByFloatRange(buckets, null, 0.10);
    expect(result).toHaveLength(2); // FN (0–0.07) and MW (0.07–0.15) overlap
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/unit/dataviewer-filters.test.ts
```

Expected: FAIL — module `filter-utils.js` not found.

- [ ] **Step 3: Implement filter-utils.ts**

Create `src/components/data-viewer/filter-utils.ts`:

```typescript
/** Condition float boundaries */
export const CONDITION_RANGES: Record<string, { min: number; max: number }> = {
  "Factory New": { min: 0, max: 0.07 },
  "Minimal Wear": { min: 0.07, max: 0.15 },
  "Field-Tested": { min: 0.15, max: 0.38 },
  "Well-Worn": { min: 0.38, max: 0.45 },
  "Battle-Scarred": { min: 0.45, max: 1 },
};

/** Returns conditions whose float range overlaps the skin's [skinMin, skinMax] */
export function getAvailableConditions(
  skinMin: number,
  skinMax: number,
): { name: string; min: number; max: number }[] {
  return Object.entries(CONDITION_RANGES)
    .filter(([, range]) => range.max > skinMin && range.min < skinMax)
    .map(([name, range]) => ({ name, ...range }));
}

/** Filter items with a float_value by [min, max]. Inclusive on both ends. null = no bound. */
export function filterByFloatRange<T extends { float_value: number }>(
  items: T[],
  min: number | null,
  max: number | null,
): T[] {
  if (min === null && max === null) return items;
  return items.filter(item => {
    if (min !== null && item.float_value < min) return false;
    if (max !== null && item.float_value > max) return false;
    return true;
  });
}

/** Filter items by a date field within [from, to]. null = no bound. */
export function filterByTimeRange<T>(
  items: T[],
  dateKey: keyof T,
  from: Date | null,
  to: Date | null,
): T[] {
  if (from === null && to === null) return items;
  return items.filter(item => {
    const ts = new Date(item[dateKey] as string).getTime();
    if (from !== null && ts < from.getTime()) return false;
    if (to !== null && ts > to.getTime()) return false;
    return true;
  });
}

/** Filter float buckets by overlap with [min, max]. null = no bound. */
export function filterBucketsByFloatRange(
  buckets: { float_min: number; float_max: number }[],
  min: number | null,
  max: number | null,
): typeof buckets {
  if (min === null && max === null) return buckets;
  return buckets.filter(b => {
    if (min !== null && b.float_max <= min) return false;
    if (max !== null && b.float_min >= max) return false;
    return true;
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/unit/dataviewer-filters.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/data-viewer/filter-utils.ts tests/unit/dataviewer-filters.test.ts
git commit -m "feat: add filter utility functions for dataviewer float/time filtering"
```

---

### Task 3: Create FilterBar component

**Files:**
- Create: `src/components/data-viewer/FilterBar.tsx`

- [ ] **Step 1: Create FilterBar.tsx**

Create `src/components/data-viewer/FilterBar.tsx`:

```tsx
import { useState, useEffect } from "react";
import { Button } from "@shared/components/ui/button.js";
import { Input } from "@shared/components/ui/input.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@shared/components/ui/select.js";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@shared/components/ui/popover.js";
import { Calendar } from "@shared/components/ui/calendar.js";
import { getAvailableConditions } from "./filter-utils.js";

interface FilterBarProps {
  floatRange: { min: number | null; max: number | null };
  timeRange: { from: Date | null; to: Date | null };
  onFloatRangeChange: (range: { min: number | null; max: number | null }) => void;
  onTimeRangeChange: (range: { from: Date | null; to: Date | null }) => void;
  skinMinFloat: number;
  skinMaxFloat: number;
}

type TimePreset = "7d" | "30d" | "90d" | "all";

function formatDate(d: Date | null): string {
  if (!d) return "";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function daysAgo(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function FilterBar({
  floatRange,
  timeRange,
  onFloatRangeChange,
  onTimeRangeChange,
  skinMinFloat,
  skinMaxFloat,
}: FilterBarProps) {
  const [conditionKey, setConditionKey] = useState<string>("any");
  const [minInput, setMinInput] = useState("");
  const [maxInput, setMaxInput] = useState("");

  const conditions = getAvailableConditions(skinMinFloat, skinMaxFloat);

  // Determine which time preset is active (if any)
  const activePreset = ((): TimePreset | null => {
    if (timeRange.from === null && timeRange.to === null) return "all";
    if (timeRange.to !== null) return null; // custom "to" means no preset
    if (!timeRange.from) return null;
    const diffMs = Date.now() - timeRange.from.getTime();
    const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
    if (diffDays >= 6 && diffDays <= 8) return "7d";
    if (diffDays >= 29 && diffDays <= 31) return "30d";
    if (diffDays >= 89 && diffDays <= 91) return "90d";
    return null;
  })();

  // Sync text inputs when floatRange changes externally (e.g., condition select)
  useEffect(() => {
    setMinInput(floatRange.min !== null ? String(floatRange.min) : "");
    setMaxInput(floatRange.max !== null ? String(floatRange.max) : "");
  }, [floatRange.min, floatRange.max]);

  function handleConditionChange(value: string) {
    setConditionKey(value);
    if (value === "any") {
      onFloatRangeChange({ min: null, max: null });
    } else {
      const cond = conditions.find(c => c.name === value);
      if (cond) {
        onFloatRangeChange({ min: cond.min, max: cond.max });
      }
    }
  }

  function handleMinBlur() {
    const val = minInput.trim() === "" ? null : parseFloat(minInput);
    if (val !== null && isNaN(val)) return;
    setConditionKey("custom");
    onFloatRangeChange({ min: val, max: floatRange.max });
  }

  function handleMaxBlur() {
    const val = maxInput.trim() === "" ? null : parseFloat(maxInput);
    if (val !== null && isNaN(val)) return;
    setConditionKey("custom");
    onFloatRangeChange({ min: floatRange.min, max: val });
  }

  function handleTimePreset(preset: TimePreset) {
    if (preset === "all") {
      onTimeRangeChange({ from: null, to: null });
    } else {
      const days = preset === "7d" ? 7 : preset === "30d" ? 30 : 90;
      onTimeRangeChange({ from: daysAgo(days), to: null });
    }
  }

  const hasFloatFilter = floatRange.min !== null || floatRange.max !== null;
  const hasTimeFilter = timeRange.from !== null || timeRange.to !== null;

  return (
    <div className="space-y-2 mb-3 text-xs">
      {/* Row 1: Float Range */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-muted-foreground font-medium shrink-0">Float:</span>
        <Select value={conditionKey} onValueChange={handleConditionChange}>
          <SelectTrigger className="h-7 w-[140px] text-xs">
            <SelectValue placeholder="Any" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="any">Any</SelectItem>
            {conditions.map(c => (
              <SelectItem key={c.name} value={c.name}>
                {c.name} ({c.min}–{c.max.toFixed(2)})
              </SelectItem>
            ))}
            {conditionKey === "custom" && (
              <SelectItem value="custom">Custom</SelectItem>
            )}
          </SelectContent>
        </Select>
        <Input
          type="number"
          step="0.01"
          min={0}
          max={1}
          placeholder="Min"
          value={minInput}
          onChange={e => setMinInput(e.target.value)}
          onBlur={handleMinBlur}
          className="h-7 w-[80px] text-xs"
        />
        <span className="text-muted-foreground">–</span>
        <Input
          type="number"
          step="0.01"
          min={0}
          max={1}
          placeholder="Max"
          value={maxInput}
          onChange={e => setMaxInput(e.target.value)}
          onBlur={handleMaxBlur}
          className="h-7 w-[80px] text-xs"
        />
        {hasFloatFilter && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs text-muted-foreground"
            onClick={() => {
              setConditionKey("any");
              onFloatRangeChange({ min: null, max: null });
            }}
          >
            Clear
          </Button>
        )}
      </div>

      {/* Row 2: Time Range */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-muted-foreground font-medium shrink-0">Time:</span>
        <div className="flex gap-1">
          {(["7d", "30d", "90d", "all"] as const).map(preset => (
            <Button
              key={preset}
              variant={activePreset === preset ? "default" : "outline"}
              size="sm"
              className="h-7 px-2.5 text-xs"
              onClick={() => handleTimePreset(preset)}
            >
              {preset === "all" ? "All" : preset}
            </Button>
          ))}
        </div>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-7 px-2 text-xs font-normal">
              {timeRange.from ? formatDate(timeRange.from) : "From"}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="single"
              selected={timeRange.from ?? undefined}
              onSelect={day => onTimeRangeChange({ from: day ?? null, to: timeRange.to })}
              initialFocus
            />
          </PopoverContent>
        </Popover>
        <span className="text-muted-foreground">–</span>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-7 px-2 text-xs font-normal">
              {timeRange.to ? formatDate(timeRange.to) : "Now"}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="single"
              selected={timeRange.to ?? undefined}
              onSelect={day => onTimeRangeChange({ from: timeRange.from, to: day ?? null })}
              initialFocus
            />
          </PopoverContent>
        </Popover>
        {hasTimeFilter && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs text-muted-foreground"
            onClick={() => onTimeRangeChange({ from: null, to: null })}
          >
            Clear
          </Button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify typecheck passes**

```bash
npx tsc --noEmit
```

Expected: no errors. If shadcn Calendar has different prop names, adjust accordingly — check `shared/components/ui/calendar.tsx` for the exact props.

- [ ] **Step 3: Commit**

```bash
git add src/components/data-viewer/FilterBar.tsx
git commit -m "feat: add FilterBar component with float range and time range controls"
```

---

### Task 4: Integrate FilterBar into SkinDetailPanel

**Files:**
- Modify: `src/components/data-viewer/SkinDetailPanel.tsx`

This task wires up filter state, the filtering useMemo, and renders the FilterBar.

- [ ] **Step 1: Add imports**

At the top of `SkinDetailPanel.tsx`, add:

```typescript
import { FilterBar } from "./FilterBar.js";
import { filterByFloatRange, filterByTimeRange, filterBucketsByFloatRange } from "./filter-utils.js";
```

- [ ] **Step 2: Add filter state**

After the existing `selectedPhase` state (line 54), add:

```typescript
const [floatRange, setFloatRange] = useState<{ min: number | null; max: number | null }>({ min: null, max: null });
const [timeRange, setTimeRange] = useState<{ from: Date | null; to: Date | null }>({ from: null, to: null });
```

- [ ] **Step 3: Add filtering useMemo**

After the existing `saleHistory` useMemo (around line 144), add the filtering memo:

```typescript
const { filteredListings, filteredSaleHistory, filteredBuckets } = useMemo(() => {
  let fl = listings;
  let fs = saleHistory;
  let fb = bucketFloors;

  // Float range filter
  fl = filterByFloatRange(fl, floatRange.min, floatRange.max);
  fs = filterByFloatRange(fs, floatRange.min, floatRange.max);
  fb = filterBucketsByFloatRange(fb, floatRange.min, floatRange.max);

  // Time range filter
  fl = filterByTimeRange(fl, "created_at", timeRange.from, timeRange.to);
  fs = filterByTimeRange(fs, "sold_at", timeRange.from, timeRange.to);
  // Hide buckets entirely when time filter active
  if (timeRange.from !== null || timeRange.to !== null) {
    fb = [];
  }

  return { filteredListings: fl, filteredSaleHistory: fs, filteredBuckets: fb };
}, [listings, saleHistory, bucketFloors, floatRange, timeRange]);
```

- [ ] **Step 4: Override visible.buckets when time filter active**

In the `chartContent` function, replace the line that passes `visible` to ScatterChart. Change:

```typescript
visible={visible}
```

to:

```typescript
visible={timeRange.from !== null || timeRange.to !== null ? { ...visible, buckets: false } : visible}
```

- [ ] **Step 5: Replace data arrays with filtered versions**

In the `chartContent` function, replace the ScatterChart props:

Change:
```typescript
listings={listings}
saleHistory={saleHistory || []}
floatBuckets={bucketFloors}
```

To:
```typescript
listings={filteredListings}
saleHistory={filteredSaleHistory}
floatBuckets={filteredBuckets}
```

- [ ] **Step 6: Update legend counts to use filtered data**

Replace the count calculations (lines 159-166) to use filtered data. Change:

```typescript
const csfloatCount = listings.filter(l => !l.source || l.source === "csfloat").length;
const dmarketCount = listings.filter(l => l.source === "dmarket").length;
const skinportCount = listings.filter(l => l.source === "skinport").length;
const buffCount = listings.filter(l => l.source === "buff").length;

const csfloatSaleCount = (saleHistory || []).filter(s => !s.source || s.source === "sale" || s.source === "listing" || s.source === "listing_dmarket" || s.source === "listing_skinport").length;
const skinportSaleCount = (saleHistory || []).filter(s => s.source === "skinport_sale").length;
const buffSaleCount = (saleHistory || []).filter(s => s.source === "buff_sale").length;
```

To:

```typescript
const csfloatCount = filteredListings.filter(l => !l.source || l.source === "csfloat").length;
const dmarketCount = filteredListings.filter(l => l.source === "dmarket").length;
const skinportCount = filteredListings.filter(l => l.source === "skinport").length;
const buffCount = filteredListings.filter(l => l.source === "buff").length;

const csfloatSaleCount = filteredSaleHistory.filter(s => !s.source || s.source === "sale" || s.source === "listing" || s.source === "listing_dmarket" || s.source === "listing_skinport").length;
const skinportSaleCount = filteredSaleHistory.filter(s => s.source === "skinport_sale").length;
const buffSaleCount = filteredSaleHistory.filter(s => s.source === "buff_sale").length;
```

- [ ] **Step 7: Update filteredListings for the Listings table**

Change the source filter logic (around line 180) from:

```typescript
const filteredListings = listings.filter(l => {
  const src = l.source || "csfloat";
  return sourceFilters[src] !== false;
});
```

To (rename to avoid shadowing):

```typescript
const tableListings = filteredListings.filter(l => {
  const src = l.source || "csfloat";
  return sourceFilters[src] !== false;
});
```

Then update the Listings table section to use `tableListings` instead of the old `filteredListings`:
- The heading count: `tableListings.length` and `filteredListings.length`
- The SortableTable data prop: `data={tableListings}`

- [ ] **Step 8: Update Sale History table to use filtered data**

The SortableTable for sale history already uses `saleHistory`. Change it to use `filteredSaleHistory`:

```typescript
data={filteredSaleHistory}
```

And update the heading count:

```typescript
Sale History ({filteredSaleHistory.length})
```

- [ ] **Step 9: Render FilterBar**

In the JSX, between the Doppler phase tabs section (line ~297) and the scatter chart section (line ~299), add:

```tsx
{/* Data filters */}
<FilterBar
  floatRange={floatRange}
  timeRange={timeRange}
  onFloatRangeChange={setFloatRange}
  onTimeRangeChange={setTimeRange}
  skinMinFloat={skin.min_float}
  skinMaxFloat={skin.max_float}
/>
```

- [ ] **Step 10: Disable buckets legend when time filter active**

In the legend items array, update the bucket legend item to show as disabled when time filter is active. After the `legendItems` array definition, add conditional styling for the buckets item when time-filtered. The simplest approach: in the legend rendering JSX, add a check:

In the `chartContent` function, where legend items are rendered, update the opacity logic:

```tsx
className={`cursor-pointer inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded transition-[opacity,background] select-none hover:bg-accent ${
  visible[item.key] ? "" : "opacity-35 line-through"
} ${item.key === "buckets" && (timeRange.from !== null || timeRange.to !== null) ? "opacity-35 pointer-events-none" : ""}`}
```

Note: `chartContent` is defined inside the component's render, so it has access to `timeRange` via closure.

- [ ] **Step 11: Reset filters when skin changes**

Add a useEffect to reset filters when the skin changes (when `skinName` prop changes):

```typescript
useEffect(() => {
  setFloatRange({ min: null, max: null });
  setTimeRange({ from: null, to: null });
}, [skinName]);
```

Place this after the existing data-fetching useEffect.

- [ ] **Step 12: Verify typecheck passes**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 13: Run existing tests**

```bash
npm test
```

Expected: all existing tests still pass (no backend changes, and these are frontend component changes).

- [ ] **Step 14: Commit**

```bash
git add src/components/data-viewer/SkinDetailPanel.tsx
git commit -m "feat: integrate float range and time range filters into dataviewer

Adds filter state to SkinDetailPanel, filters all data series
(listings, sales, buckets) client-side via useMemo. Legend counts
reflect filtered data. Float buckets hidden when time filter active.
Filters reset on skin change."
```

---

### Task 5: Manual smoke test

- [ ] **Step 1: Start the dev server**

```bash
npm run dev
```

- [ ] **Step 2: Verify filter bar renders**

Open the dataviewer, select a skin. The FilterBar should appear between phase tabs (or header) and the scatter chart. Both rows visible: Float row with condition dropdown + min/max inputs, Time row with preset buttons + date pickers.

- [ ] **Step 3: Test float range filter**

- Select "Factory New" from condition dropdown → chart should zoom to 0–0.07 float range, only showing FN listings/sales. Axes should rescale.
- Type custom values in min/max → dropdown switches to "Custom", chart filters accordingly.
- Click "Clear" → all data returns, axes rescale back.

- [ ] **Step 4: Test time range filter**

- Click "7d" → only listings/sales from last 7 days. Float buckets should disappear. Buckets legend should be dimmed.
- Click "30d" → wider range. "30d" button highlighted.
- Use date pickers for custom range → both buttons lose highlight.
- Click "All" → all data returns, buckets reappear.

- [ ] **Step 5: Test combined filters**

- Set float to "Minimal Wear" AND time to "30d" → should see only MW listings from last 30 days. No buckets.

- [ ] **Step 6: Test skin change resets filters**

- Apply filters, then click a different skin in the list → filters should reset to defaults (Any / All).

- [ ] **Step 7: Final commit if any tweaks needed**

```bash
git add -A
git commit -m "fix: polish filter bar styling and behavior after smoke test"
```

(Only if changes were needed.)
