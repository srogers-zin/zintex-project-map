"use client";

import { useEffect, useState } from "react";
import type { Location, Review } from "@/lib/types";
import { fetchReviews } from "@/lib/api-client";
import { Stars } from "@/components/Stars";

interface ReviewsPanelProps {
  open: boolean;
  onClose: () => void;
  locations: Location[];
  activeLocationIds: string[];
  // Present only for reviews the sync matched to a specific homeowner's
  // project (see scripts/sync-birdeye-reviews.ts). Opens that project's modal.
  onSelectProject: (projectId: string) => void;
}

function relativeTime(iso: string): string {
  const days = Math.floor((Date.parse("2026-07-13") - Date.parse(iso)) / 86400000);
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

export function ReviewsPanel({ open, onClose, locations, activeLocationIds, onSelectProject }: ReviewsPanelProps) {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [avg, setAvg] = useState(0);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetchReviews(activeLocationIds)
      .then((data) => {
        setReviews(data.reviews.slice(0, 100));
        setAvg(data.averageRating);
        setCount(data.count);
      })
      .finally(() => setLoading(false));
  }, [open, activeLocationIds]);

  const nameById = new Map(locations.map((l) => [l.id, l.name]));

  return (
    <>
      {open && <div className="fixed inset-0 z-30 bg-black/20" onClick={onClose} />}
      <div
        className={`fixed right-0 top-0 z-40 h-full w-96 max-w-[90vw] transform bg-white shadow-xl transition-transform ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-700">Reviews</h2>
            <div className="mt-0.5 flex items-center gap-2">
              <Stars rating={avg} />
              <span className="text-xs text-slate-500">
                {avg.toFixed(1)} · {count.toLocaleString()} reviews
              </span>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600" aria-label="Close">
            ✕
          </button>
        </div>

        <div className="scroll-thin h-[calc(100%-64px)] overflow-y-auto p-4">
          {loading && <p className="text-sm text-slate-400">Loading reviews…</p>}
          <div className="space-y-4">
            {reviews.map((r) => (
              <div key={r.id} className="border-b border-slate-100 pb-4 last:border-0">
                <div className="flex items-center gap-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-100 text-sm font-semibold text-brand-700">
                    {r.authorName.charAt(0)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-700">{r.authorName}</p>
                    <p className="text-xs text-slate-400">
                      {nameById.get(r.locationId) ?? r.locationId} · {relativeTime(r.postedAt)}
                    </p>
                  </div>
                  <Stars rating={r.rating} size={12} />
                </div>
                <p className="mt-2 text-sm text-slate-600">{r.text}</p>
                {r.projectId && (
                  <button
                    onClick={() => onSelectProject(r.projectId!)}
                    className="mt-1 text-xs font-medium text-brand-600 hover:underline"
                  >
                    View this project's photos
                  </button>
                )}
              </div>
            ))}
          </div>
          <p className="mt-4 text-center text-[11px] text-slate-300">
            Synced from Birdeye. Reviews with a matching homeowner name link to that project.
          </p>
        </div>
      </div>
    </>
  );
}
