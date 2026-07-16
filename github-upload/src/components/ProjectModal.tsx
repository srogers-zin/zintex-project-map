"use client";

import { useEffect, useState } from "react";
import type { ProjectDetail } from "@/lib/types";
import { fetchProjectDetail } from "@/lib/api-client";

export function ProjectModal({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [photoIdx, setPhotoIdx] = useState(0);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setLoading(true);
    setPhotoIdx(0);
    fetchProjectDetail(projectId)
      .then(setDetail)
      .finally(() => setLoading(false));
  }, [projectId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function share() {
    // Shareable per-project link (rep can text/email during a consultation).
    const url = `${window.location.origin}/?project=${projectId}`;
    navigator.clipboard?.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  const photos = detail?.photos ?? [];
  const current = photos[photoIdx];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="scroll-thin max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2 border-b border-slate-100 p-4">
          <h2 className="text-sm font-semibold text-slate-800">
            {loading ? "Loading…" : detail?.address ?? "Project not available"}
          </h2>
          <div className="flex shrink-0 items-center gap-1">
            <button
              onClick={share}
              className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              aria-label="Share project"
              title="Copy shareable link"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
                <path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" />
              </svg>
            </button>
            <button onClick={onClose} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100" aria-label="Close">
              ✕
            </button>
          </div>
        </div>

        {copied && <p className="bg-green-50 px-4 py-1.5 text-center text-xs text-green-700">Link copied to clipboard</p>}

        {detail && (
          <div className="p-4">
            {/* Photo gallery */}
            {photos.length > 0 ? (
              <div className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={current.url}
                  alt={detail.address}
                  className="h-80 w-full rounded-lg bg-slate-100 object-contain"
                />
                {photos.length > 1 && (
                  <>
                    <button
                      onClick={() => setPhotoIdx((i) => (i - 1 + photos.length) % photos.length)}
                      className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-black/50 px-2 py-1 text-white"
                      aria-label="Previous photo"
                    >
                      ‹
                    </button>
                    <button
                      onClick={() => setPhotoIdx((i) => (i + 1) % photos.length)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-black/50 px-2 py-1 text-white"
                      aria-label="Next photo"
                    >
                      ›
                    </button>
                    <span className="absolute bottom-2 right-2 rounded bg-black/60 px-2 py-0.5 text-xs text-white">
                      {photoIdx + 1} of {photos.length}
                    </span>
                  </>
                )}
              </div>
            ) : (
              <div className="flex h-40 items-center justify-center rounded-lg bg-slate-100 text-sm text-slate-400">
                No photos for this project
              </div>
            )}

            {/* Work details / tags */}
            <div className="mt-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Work Details</h3>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {detail.tags.length ? (
                  detail.tags.map((t) => (
                    <span key={t} className="rounded-full bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-700">
                      {t}
                    </span>
                  ))
                ) : (
                  <span className="text-xs text-slate-400">No service tags</span>
                )}
              </div>
              <p className="mt-2 text-xs text-slate-400">Serviced by our {detail.locationName} branch</p>
            </div>
          </div>
        )}

        {!loading && !detail && (
          <div className="p-6 text-center text-sm text-slate-500">
            This project isn't available. It may have been removed at the homeowner's request.
          </div>
        )}
      </div>
    </div>
  );
}
