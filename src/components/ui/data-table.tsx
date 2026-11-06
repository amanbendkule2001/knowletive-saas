import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/ui/primitives";

export type Column<T> = {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  className?: string;
  align?: "left" | "right";
  /** How the column appears in the mobile card layout. */
  mobile?: "title" | "subtitle" | "hidden" | "detail";
};

export function DataTable<T extends { id: string }>({
  columns,
  rows,
  emptyTitle = "Nothing here yet",
  emptyDescription,
  emptyAction,
  footer,
  className,
}: {
  columns: Column<T>[];
  rows: T[];
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  if (rows.length === 0) {
    return (
      <div className={cn("card", className)}>
        <EmptyState title={emptyTitle} description={emptyDescription} action={emptyAction} />
      </div>
    );
  }

  const titleCol = columns.find((c) => c.mobile === "title") ?? columns[0];
  const subtitleCol = columns.find((c) => c.mobile === "subtitle");
  const detailCols = columns.filter(
    (c) => c !== titleCol && c !== subtitleCol && c.mobile !== "hidden",
  );

  return (
    <div className={cn("card overflow-hidden", className)}>
      {/* Desktop */}
      <div className="table-wrap hidden md:block">
        <table className="data-table">
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key} className={cn(c.align === "right" && "text-right", c.className)}>
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={cn(c.align === "right" && "text-right", c.className)}
                  >
                    {c.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="divide-y divide-[var(--border)] md:hidden">
        {rows.map((row) => (
          <div key={row.id} className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">{titleCol.render(row)}</div>
              {columns
                .filter((c) => c.mobile === "hidden")
                .slice(0, 1)
                .map((c) => (
                  <div key={c.key} className="shrink-0">
                    {c.render(row)}
                  </div>
                ))}
            </div>
            {subtitleCol && <div className="mt-1 text-xs text-muted">{subtitleCol.render(row)}</div>}
            {detailCols.length > 0 && (
              <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2">
                {detailCols.map((c) => (
                  <div key={c.key} className="min-w-0">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-2)]">
                      {c.header}
                    </p>
                    <div className="truncate text-[13px]">{c.render(row)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      {footer}
    </div>
  );
}
