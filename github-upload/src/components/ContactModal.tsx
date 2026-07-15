"use client";

import { LeadForm } from "@/components/LeadForm";

// General "get in touch" entry point, reachable from the persistent header
// button rather than tied to any one project. ProjectModal is pure photo
// browsing now — this is the only place leads get captured.
export function ContactModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="w-full max-w-sm rounded-xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2 border-b border-slate-100 p-4">
          <h2 className="text-sm font-semibold text-slate-800">Get in touch</h2>
          <button onClick={onClose} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100" aria-label="Close">
            ✕
          </button>
        </div>
        <div className="p-4">
          <LeadForm projectId={null} />
        </div>
      </div>
    </div>
  );
}
