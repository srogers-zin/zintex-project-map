"use client";

import type { Project } from "@/lib/types";

interface SidebarProps {
  items: Project[];
  total: number;
  loading: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onLoadMore: () => void;
  hasMore: boolean;
}

function CameraIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  );
}

export function Sidebar({ items, total, loading, selectedId, onSelect, onLoadMore, hasMore }: SidebarProps) {
  return (
    <aside className="flex h-full w-full flex-col bg-white md:w-80 md:border-r md:border-slate-200">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <h2 className="text-sm font-semibold text-slate-700">Projects</h2>
        <span className="rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-semibold text-brand-700">
          Total {total.toLocaleString()}
        </span>
      </div>

      <ul className="scroll-thin flex-1 divide-y divide-slate-100 overflow-y-auto">
        {items.length === 0 && !loading && (
          <li className="px-4 py-8 text-center text-sm text-slate-400">
            No projects match your filters.
          </li>
        )}
        {items.map((p) => (
          <li key={p.id}>
            <button
              onClick={() => onSelect(p.id)}
              className={`flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-slate-50 ${
                selectedId === p.id ? "bg-brand-50" : ""
              }`}
            >
              <span className={`shrink-0 ${p.photoCount > 0 ? "text-green-600" : "text-slate-300"}`}>
                <CameraIcon />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-slate-700">{p.address}</span>
                <span className="mt-0.5 block truncate text-xs text-slate-400">
                  {p.tags.join(" · ") || "—"}
                </span>
              </span>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2" aria-hidden="true">
                <path d="M9 18l6-6-6-6" />
              </svg>
            </button>
          </li>
        ))}
      </ul>

      <div className="border-t border-slate-200 p-3">
        {hasMore ? (
          <button
            onClick={onLoadMore}
            disabled={loading}
            className="w-full rounded-md border border-slate-200 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            {loading ? "Loading…" : "Load more"}
          </button>
        ) : (
          <p className="text-center text-xs text-slate-400">
            Showing {items.length.toLocaleString()} of {total.toLocaleString()}
          </p>
        )}
      </div>
    </aside>
  );
}
