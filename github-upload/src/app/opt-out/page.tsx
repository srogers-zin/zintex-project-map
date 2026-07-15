"use client";

import { useState } from "react";

// Public homeowner opt-out page. This is a compliance requirement: real home
// addresses are published on the map, and homeowners must be able to remove
// their property. Submissions suppress matching projects immediately.
export default function OptOutPage() {
  const [addressOrProjectId, setValue] = useState("");
  const [contactEmail, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "done" | "error">("idle");
  const [result, setResult] = useState<{ suppressedCount: number } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("submitting");
    const res = await fetch("/api/opt-outs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ addressOrProjectId, contactEmail: contactEmail || null, method: "form" }),
    });
    if (res.ok) {
      setResult(await res.json());
      setStatus("done");
    } else {
      setStatus("error");
    }
  }

  return (
    <main className="mx-auto max-w-lg px-4 py-12">
      <a href="/" className="text-sm text-brand-600 hover:underline">
        ← Back to the map
      </a>
      <h1 className="mt-4 text-2xl font-semibold text-slate-800">Remove your property from the map</h1>
      <p className="mt-2 text-sm text-slate-600">
        If a project at your address appears on our public map and you’d like it removed, enter your
        address (or the project ID from a shared link) below. We’ll suppress it from the public map right
        away and keep a record of your request.
      </p>

      {status === "done" ? (
        <div className="mt-6 rounded-lg bg-green-50 p-4 text-sm text-green-800">
          <p className="font-medium">Your request has been recorded.</p>
          <p className="mt-1">
            {result?.suppressedCount ? (
              <>We hid {result.suppressedCount} matching project(s) from the public map.</>
            ) : (
              <>
                We didn’t find a public match right now, but your request is on file and we’ll ensure
                nothing at that address is published.
              </>
            )}
          </p>
        </div>
      ) : (
        <form onSubmit={submit} className="mt-6 space-y-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Address or project ID</label>
            <input
              value={addressOrProjectId}
              onChange={(e) => setValue(e.target.value)}
              placeholder="123 Oak St, Abilene, TX"
              required
              minLength={3}
              className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Your email <span className="font-normal text-slate-400">(optional, for confirmation)</span>
            </label>
            <input
              type="email"
              value={contactEmail}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
            />
          </div>
          <button
            type="submit"
            disabled={status === "submitting"}
            className="w-full rounded-md bg-brand-600 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {status === "submitting" ? "Submitting…" : "Remove my property"}
          </button>
          {status === "error" && <p className="text-sm text-red-500">Something went wrong. Please try again.</p>}
        </form>
      )}

      <p className="mt-6 text-xs text-slate-400">
        Note: This suppression is enforced on every public query. For a permanent record, opt-outs are
        also stored so future syncs never re-publish the address.
      </p>
    </main>
  );
}
