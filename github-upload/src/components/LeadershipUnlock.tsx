"use client";

import { useEffect, useState } from "react";

// Cookie name must match src/app/api/leadership/route.ts.
const COOKIE_NAME = "leadership_unlocked";

function readUnlocked(): boolean {
  if (typeof document === "undefined") return false;
  return document.cookie.split("; ").some((c) => c === `${COOKIE_NAME}=1`);
}

// Small, deliberately unlabeled lock icon in the header. Locked by default
// on every device — including sales reps' presentation iPads. Entering the
// shared passcode (see src/app/api/leadership/route.ts) unlocks
// CompanyCam links in the project popup for ~24h on that browser, or until
// manually locked again via the same icon.
export function LeadershipUnlock({ onChange }: { onChange: (unlocked: boolean) => void }) {
  const [unlocked, setUnlocked] = useState(false);
  const [open, setOpen] = useState(false);
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const u = readUnlocked();
    setUnlocked(u);
    onChange(u);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submit() {
    if (!passcode || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/leadership", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passcode }),
      });
      if (!res.ok) {
        setError("Incorrect passcode");
        return;
      }
      setUnlocked(true);
      onChange(true);
      setOpen(false);
      setPasscode("");
    } finally {
      setSubmitting(false);
    }
  }

  async function lock() {
    await fetch("/api/leadership", { method: "DELETE" });
    setUnlocked(false);
    onChange(false);
    setOpen(false);
  }

  return (
    <div className="relative">
      <button
        onClick={() => (unlocked ? lock() : setOpen((v) => !v))}
        className={`rounded-md border p-1.5 ${
          unlocked
            ? "border-brand-600 text-brand-600 hover:bg-brand-50"
            : "border-slate-200 text-slate-400 hover:bg-slate-50"
        }`}
        aria-label={unlocked ? "Lock leadership mode" : "Leadership mode"}
        title={unlocked ? "Leadership mode is on — click to lock" : "Leadership mode"}
      >
        {unlocked ? (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="5" y="10" width="14" height="10" rx="1" />
            <path d="M8 10V7a4 4 0 018 0v3" />
          </svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="5" y="10" width="14" height="10" rx="1" />
            <path d="M8 10V7a4 4 0 017.94-.9" />
          </svg>
        )}
      </button>

      {open && !unlocked && (
        <div className="absolute right-0 top-full z-30 mt-2 w-56 rounded-md border border-slate-200 bg-white p-3 shadow-lg">
          <p className="mb-2 text-xs font-medium text-slate-600">Leadership passcode</p>
          <input
            type="password"
            value={passcode}
            onChange={(e) => setPasscode(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            autoFocus
            className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm focus:border-brand-500 focus:outline-none"
          />
          {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
          <button
            onClick={submit}
            disabled={submitting || !passcode}
            className="mt-2 w-full rounded-md bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            Unlock
          </button>
        </div>
      )}
    </div>
  );
}
