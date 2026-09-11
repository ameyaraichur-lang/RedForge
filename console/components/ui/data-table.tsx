'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface Column<T> {
  key: string;
  header: string;
  align?: 'left' | 'center' | 'right';
  width?: string;
  sortable?: boolean;
  /** Value used for sorting; defaults to row[key]. */
  value?: (row: T) => string | number;
  render?: (row: T) => ReactNode;
  headerClassName?: string;
  cellClassName?: string;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  initialSort?: { key: string; dir: 'asc' | 'desc' };
  maxHeight?: string;
  className?: string;
}

const ALIGN: Record<'left' | 'center' | 'right', string> = {
  left: 'text-left',
  center: 'text-center',
  right: 'text-right',
};

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  initialSort,
  maxHeight,
  className,
}: DataTableProps<T>) {
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(initialSort ?? null);

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col) return rows;
    const get = col.value ?? ((row: T) => (row as unknown as Record<string, unknown>)[col.key] as string | number);
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const va = get(a);
      const vb = get(b);
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
      return String(va).localeCompare(String(vb)) * dir;
    });
  }, [rows, sort, columns]);

  function toggleSort(key: string) {
    setSort((prev) => {
      if (prev?.key !== key) return { key, dir: 'asc' };
      if (prev.dir === 'asc') return { key, dir: 'desc' };
      return null;
    });
  }

  return (
    <div
      className={cn(
        'overflow-auto rounded-md border border-line bg-panel',
        maxHeight,
        className,
      )}
    >
      <table className="w-full border-collapse text-[12px]">
        <thead>
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                scope="col"
                style={col.width ? { width: col.width } : undefined}
                className={cn(
                  'sticky top-0 z-10 border-b border-line bg-ink-2 px-3 py-2 font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-dim',
                  ALIGN[col.align ?? 'left'],
                  col.headerClassName,
                )}
              >
                {col.sortable === false ? (
                  col.header
                ) : (
                  <button
                    type="button"
                    onClick={() => toggleSort(col.key)}
                    className={cn(
                      'inline-flex items-center gap-1 uppercase tracking-[0.12em] transition-colors hover:text-acc',
                      sort?.key === col.key && 'text-acc',
                    )}
                    aria-label={`Sort by ${col.header}`}
                  >
                    {col.header}
                    <span aria-hidden className={cn('text-[8px]', sort?.key === col.key ? 'opacity-100' : 'opacity-30')}>
                      {sort?.key === col.key && sort.dir === 'desc' ? '▼' : '▲'}
                    </span>
                  </button>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 && (
            <tr>
              <td colSpan={columns.length} className="px-3 py-8 text-center font-mono text-[12px] text-dim">
                — no rows match current filters —
              </td>
            </tr>
          )}
          {sorted.map((row) => (
            <tr
              key={rowKey(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              tabIndex={onRowClick ? 0 : undefined}
              onKeyDown={
                onRowClick
                  ? (e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onRowClick(row);
                      }
                    }
                  : undefined
              }
              className={cn(
                'border-b border-line/60 last:border-b-0',
                onRowClick && 'cursor-pointer hover:bg-acc/5 focus-visible:bg-acc/5',
              )}
            >
              {columns.map((col) => (
                <td
                  key={col.key}
                  className={cn(
                    'px-3 py-1.5 align-middle text-slate-300',
                    ALIGN[col.align ?? 'left'],
                    col.cellClassName,
                  )}
                >
                  {col.render ? col.render(row) : String((row as unknown as Record<string, unknown>)[col.key] ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
