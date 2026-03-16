import { useState, useMemo } from "react";
import { Button } from "@shared/components/ui/button.js";
import type { SortDir } from "./types.js";

interface Column<T> {
  key: string;
  label: string;
  render: (row: T) => React.ReactNode;
  sortValue?: (row: T) => number | string;
  align?: "right";
}

interface SortableTableProps<T> {
  columns: Column<T>[];
  data: T[];
  defaultSort?: { key: string; dir: SortDir };
  defaultLimit?: number;
  id: string;
}

export function SortableTable<T>({ columns, data, defaultSort, defaultLimit = 20, id }: SortableTableProps<T>) {
  const [sortKey, setSortKey] = useState(defaultSort?.key ?? columns[0].key);
  const [sortDir, setSortDir] = useState<SortDir>(defaultSort?.dir ?? "asc");
  const [expanded, setExpanded] = useState(false);

  const sorted = useMemo(() => {
    const col = columns.find(c => c.key === sortKey);
    if (!col?.sortValue) return data;
    return [...data].sort((a, b) => {
      const va = col.sortValue!(a);
      const vb = col.sortValue!(b);
      const cmp = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb));
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [data, sortKey, sortDir, columns]);

  const displayed = expanded ? sorted : sorted.slice(0, defaultLimit);

  const toggleSort = (key: string) => {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("asc"); }
  };

  return (
    <div>
      <div className="max-h-[400px] overflow-y-auto">
        <table className="w-full border-collapse text-[0.8rem]">
          <thead>
            <tr>
              {columns.map(col => (
                <th
                  key={col.key}
                  onClick={() => col.sortValue && toggleSort(col.key)}
                  className={`text-left px-2.5 py-1.5 text-muted-foreground border-b border-border font-medium sticky top-0 bg-card z-[1] ${col.sortValue ? "cursor-pointer select-none hover:text-foreground/70" : ""}`}
                  style={col.align ? { textAlign: col.align } : undefined}
                >
                  {col.label}
                  {col.sortValue && sortKey === col.key && <span className="text-[0.65rem] text-blue-400">{sortDir === "asc" ? " \u25B2" : " \u25BC"}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {displayed.map((row, i) => (
              <tr key={`${id}-${i}`} className="hover:[&>td]:bg-muted">
                {columns.map(col => (
                  <td key={col.key} className="px-2.5 py-1 text-foreground/80 border-b border-border/70" style={col.align ? { textAlign: col.align } : undefined}>
                    {col.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data.length > defaultLimit && (
        <Button
          variant="outline"
          size="sm"
          className="w-full mt-1 text-blue-400 text-xs"
          onClick={() => setExpanded(e => !e)}
        >
          {expanded ? `Show less (${defaultLimit})` : `Show all ${data.length} rows`}
        </Button>
      )}
    </div>
  );
}
