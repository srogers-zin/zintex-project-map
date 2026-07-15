"use client";

import { useState } from "react";

// Lead capture form. Posts to /api/leads (which routes to CRM in production).
export function LeadForm({ projectId }: { projectId: string | null }) {
  const [form, setForm] = useState({ name: "", phone: "", email: "", message: "" });
  const [status, setStatus] = useState<"idle" | "submitting" | "done" | "error">("idle");
  const [errors, setErrors] = useState<Record<string, string[]>>({});

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("submitting");
    setErrors({});
    const res = await fetch("/api/leads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, projectId }),
    });
    if (res.ok) {
      setStatus("done");
    } else if (res.status === 422) {
      const data = await res.json();
      setErrors(data.issues ?? {});
      setStatus("error");
    } else {
      setStatus("error");
    }
  }

  if (status === "done") {
    return (
      <div className="rounded-lg bg-green-50 p-4 text-center text-sm text-green-800">
        Thanks! A Zintex representative will reach out shortly.
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-2.5">
      {(["name", "phone", "email"] as const).map((field) => (
        <div key={field}>
          <input
            type={field === "email" ? "email" : "text"}
            placeholder={field === "name" ? "Your name" : field === "phone" ? "Phone" : "Email"}
            value={form[field]}
            onChange={(e) => setForm({ ...form, [field]: e.target.value })}
            className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
            required
          />
          {errors[field]?.length ? <p className="mt-1 text-xs text-red-500">{errors[field][0]}</p> : null}
        </div>
      ))}
      <textarea
        placeholder="How can we help? (optional)"
        value={form.message}
        onChange={(e) => setForm({ ...form, message: e.target.value })}
        rows={2}
        className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
      />
      <button
        type="submit"
        disabled={status === "submitting"}
        className="w-full rounded-md bg-brand-600 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
      >
        {status === "submitting" ? "Sending…" : "Click here to get in touch with us!"}
      </button>
      {status === "error" && Object.keys(errors).length === 0 && (
        <p className="text-xs text-red-500">Something went wrong. Please try again.</p>
      )}
    </form>
  );
}
