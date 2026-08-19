/**
 * Sortable table on the kit's `.o-table` surface. Header cells use the kit's
 * `data-slot="sort-button"` so the sort affordance is the one the theme
 * already draws rather than a new one.
 */
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";

export interface Column<Row> {
  key: string;
  label: string;
  align?: "start" | "end";
  /** Omit to make the column unsortable. */
  sortValue?: (row: Row) => number | string;
  render: (row: Row) => ReactNode;
}

export type SortDirection = "asc" | "desc";

/** Stable ordering: strings compare locale-aware, numbers numerically. */
export function sortRows<Row>(
  rows: Row[],
  column: Column<Row> | undefined,
  direction: SortDirection,
): Row[] {
  if (!column?.sortValue) return rows;
  const read = column.sortValue;
  const sign = direction === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const left = read(a);
    const right = read(b);
    if (typeof left === "number" && typeof right === "number") return (left - right) * sign;
    return String(left).localeCompare(String(right)) * sign;
  });
}

export function PreviewTable<Row>({
  columns,
  rows,
  rowKey,
  initialSort,
  initialDirection = "asc",
  empty = "Nothing to show.",
}: {
  columns: Column<Row>[];
  rows: Row[];
  rowKey: (row: Row, index: number) => string;
  initialSort?: string;
  initialDirection?: SortDirection;
  empty?: string;
}) {
  const [sortKey, setSortKey] = useState(initialSort ?? "");
  const [direction, setDirection] = useState<SortDirection>(initialDirection);
  const active = columns.find((column) => column.key === sortKey);
  const sorted = useMemo(() => sortRows(rows, active, direction), [rows, active, direction]);

  const onSort = (column: Column<Row>) => {
    if (!column.sortValue) return;
    if (column.key === sortKey) setDirection((value) => (value === "asc" ? "desc" : "asc"));
    else {
      setSortKey(column.key);
      setDirection("asc");
    }
  };

  return (
    <div className="preview-tablewrap">
      <table className="o-table preview-table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} style={{ textAlign: column.align === "end" ? "right" : "left" }}>
                {column.sortValue ? (
                  <button
                    type="button"
                    data-slot="sort-button"
                    aria-sort={column.key === sortKey ? (direction === "asc" ? "ascending" : "descending") : "none"}
                    onClick={() => onSort(column)}
                  >
                    {column.label}
                    {column.key === sortKey
                      ? (direction === "asc" ? <ArrowUp size={11} aria-hidden /> : <ArrowDown size={11} aria-hidden />)
                      : <ChevronsUpDown size={11} aria-hidden />}
                  </button>
                ) : (
                  column.label
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, index) => (
            <tr key={rowKey(row, index)}>
              {columns.map((column) => (
                <td key={column.key} style={{ textAlign: column.align === "end" ? "right" : "left" }}>
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {sorted.length === 0 && <p className="preview-note">{empty}</p>}
    </div>
  );
}
