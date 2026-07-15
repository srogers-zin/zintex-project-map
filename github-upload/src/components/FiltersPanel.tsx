"use client";

import type { Location } from "@/lib/types";
import type { Filters } from "@/lib/filters";
import { SERVICE_TAGS } from "@/lib/branches";

interface FiltersPanelProps {
  open: boolean;
  onClose: () => void;
  locations: Location[];
  filters: Filters;
  onChange: (next: Filters) => void;
}

export function FiltersPanel({ open, onClose, locations, filters, onChange }: FiltersPanelProps) {
  function toggle(list: string[], value: string): string[] {
    return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
  }

  return (
    <>
      {open && <div className="fixed inset-0 z-30 bg-black/20" onClick={onClose} />}
      <div
        className={`fixed left-0 top-0 z-40 h-full w-80 max-w-[85vw] transform bg-white shadow-xl transition-transform ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-700">View Services</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600" aria-label="Close">
            ✕
          </button>
        </div>

        <div className="scroll-thin h-[calc(100%-108px)] overflow-y-auto p-4">
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Services</h3>
            <div className="space-y-1.5">
              {SERVICE_TAGS.map((tag) => (
                <label key={tag} className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={filters.tags.includes(tag)}
                    onChange={() => onChange({ ...filters, tags: toggle(filters.tags, tag) })}
                    className="h-4 w-4 rounded border-slate-300 text-brand-600"
                  />
                  {tag}
                </label>
              ))}
            </div>
          </section>

          <section className="mt-6">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Our Locations</h3>
            <div className="space-y-1.5">
              {locations.map((loc) => (
                <label key={loc.id} className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={filters.locationIds.includes(loc.id)}
                    onChange={() => onChange({ ...filters, locationIds: toggle(filters.locationIds, loc.id) })}
                    className="h-4 w-4 rounded border-slate-300 text-brand-600"
                  />
                  {loc.name}
                </label>
              ))}
            </div>
          </section>
        </div>

        <div className="absolute bottom-0 left-0 flex w-full gap-2 border-t border-slate-200 p-3">
          <button
            onClick={() => onChange({ ...filters, tags: [], locationIds: [] })}
            className="flex-1 rounded-md border border-slate-200 py-2 text-sm text-slate-600 hover:bg-slate-50"
          >
            Clear
          </button>
          <button
            onClick={onClose}
            className="flex-1 rounded-md bg-brand-600 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            Apply
          </button>
        </div>
      </div>
    </>
  );
}
