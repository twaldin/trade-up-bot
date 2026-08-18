/**
 * Accessible Recharts wrapper copied from dashboard-saas `src/primitives/chart-figure.tsx`.
 */
import * as React from "react";
import { cn } from "../lib/cn.js";

export interface ChartData {
  columns: string[];
  rows: Array<Array<string | number>>;
}

export interface ChartFigureProps {
  title: React.ReactNode;
  description?: string;
  data?: ChartData;
  header?: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
  plotClassName?: string;
  captionVisible?: boolean;
  captionClassName?: string;
  children: React.ReactNode;
}

let uid = 0;

export function ChartFigure({
  title,
  description,
  data,
  header,
  footer,
  className,
  plotClassName,
  captionVisible = false,
  captionClassName,
  children,
}: ChartFigureProps) {
  const id = React.useMemo(() => `chart-${++uid}`, []);
  return (
    <figure
      role="group"
      aria-labelledby={`${id}-title`}
      aria-describedby={description ? `${id}-desc` : undefined}
      data-slot="chart-figure"
      className={cn("relative m-0 flex min-w-0 flex-col", className)}
    >
      <figcaption
        id={`${id}-title`}
        className={captionVisible ? captionClassName : "sr-only"}
        data-slot="chart-caption"
      >
        {title}
      </figcaption>
      {description && (
        <p id={`${id}-desc`} className="sr-only">
          {description}
        </p>
      )}
      {header}
      <div aria-hidden="true" data-slot="chart-plot" className={cn("min-w-0", plotClassName)}>
        {children}
      </div>
      {footer}
      {data && (
        <table className="sr-only">
          <caption>{title} — data table</caption>
          <thead>
            <tr>
              {data.columns.map((column) => (
                <th key={column} scope="col">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row, i) => (
              <tr key={i}>
                {row.map((cell, j) =>
                  j === 0 ? (
                    <th key={j} scope="row">
                      {cell}
                    </th>
                  ) : (
                    <td key={j}>{cell}</td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </figure>
  );
}
