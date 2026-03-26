import { useState, useEffect } from "react";
import { Button } from "@shared/components/ui/button.js";
import { Input } from "@shared/components/ui/input.js";
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
  const [conditionKey, setConditionKey] = useState("any");
  const [minInput, setMinInput] = useState("");
  const [maxInput, setMaxInput] = useState("");

  const conditions = getAvailableConditions(skinMinFloat, skinMaxFloat);

  // Determine which time preset is active (if any)
  const activePreset = ((): TimePreset | null => {
    if (timeRange.from === null && timeRange.to === null) return "all";
    if (timeRange.to !== null) return null;
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
    if (floatRange.min === null && floatRange.max === null) {
      setConditionKey("any");
    }
  }, [floatRange.min, floatRange.max]);

  function handleConditionChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const value = e.target.value;
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
        <select
          value={conditionKey}
          onChange={handleConditionChange}
          className="h-7 rounded-md border border-input bg-transparent px-2 text-xs outline-none focus:border-ring focus:ring-2 focus:ring-ring/50"
        >
          <option value="any">Any</option>
          {conditions.map(c => (
            <option key={c.name} value={c.name}>
              {c.name} ({c.min}–{c.max.toFixed(2)})
            </option>
          ))}
          {conditionKey === "custom" && (
            <option value="custom">Custom</option>
          )}
        </select>
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
        <span className="text-muted-foreground">&ndash;</span>
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
          <PopoverTrigger
            className="inline-flex items-center h-7 px-2 text-xs font-normal rounded-md border border-input bg-transparent hover:bg-accent transition-colors"
          >
            {timeRange.from ? formatDate(timeRange.from) : "From"}
          </PopoverTrigger>
          <PopoverContent align="start" className="w-auto p-0">
            <Calendar
              mode="single"
              selected={timeRange.from ?? undefined}
              onSelect={(day: Date | undefined) => onTimeRangeChange({ from: day ?? null, to: timeRange.to })}
            />
          </PopoverContent>
        </Popover>
        <span className="text-muted-foreground">&ndash;</span>
        <Popover>
          <PopoverTrigger
            className="inline-flex items-center h-7 px-2 text-xs font-normal rounded-md border border-input bg-transparent hover:bg-accent transition-colors"
          >
            {timeRange.to ? formatDate(timeRange.to) : "Now"}
          </PopoverTrigger>
          <PopoverContent align="start" className="w-auto p-0">
            <Calendar
              mode="single"
              selected={timeRange.to ?? undefined}
              onSelect={(day: Date | undefined) => onTimeRangeChange({ from: timeRange.from, to: day ?? null })}
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
