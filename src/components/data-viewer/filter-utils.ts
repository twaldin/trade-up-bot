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
export function filterBucketsByFloatRange<T extends { float_min: number; float_max: number }>(
  buckets: T[],
  min: number | null,
  max: number | null,
): T[] {
  if (min === null && max === null) return buckets;
  return buckets.filter(b => {
    if (min !== null && b.float_max <= min) return false;
    if (max !== null && b.float_min >= max) return false;
    return true;
  });
}
