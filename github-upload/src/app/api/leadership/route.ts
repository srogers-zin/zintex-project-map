import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// "Leadership mode" gate — deliberately lightweight, NOT a real accounts
// system. What's actually being protected (the "Open in CompanyCam" link
// shown in ProjectModal.tsx) isn't sensitive data by itself: CompanyCam's
// own login is the real security boundary once someone clicks through. This
// gate exists to keep sales reps from being tempted to jump in and tag
// photos themselves on the shared/company-owned presentation iPads — a
// workflow/UX control, not data protection. A single shared passcode is
// proportionate to that; if the leadership list grows or this needs to be
// audited per-person later, replace this with real accounts.
//
// Set LEADERSHIP_PASSCODE in Render's environment variables (Settings ->
// Environment) — never commit it to the repo. Changing it there takes
// effect on the next deploy/restart, no code change needed.
// ---------------------------------------------------------------------------

const COOKIE_NAME = "leadership_unlocked";
// Auto-expires so an unlock left active on a shared/company iPad doesn't
// linger indefinitely if someone forgets to lock it again.
const MAX_AGE_SECONDS = 60 * 60 * 24; // 24h

export async function POST(req: NextRequest) {
  const passcode = process.env.LEADERSHIP_PASSCODE;
  if (!passcode) {
    return NextResponse.json(
      { ok: false, error: "Leadership mode isn't configured yet (LEADERSHIP_PASSCODE is unset)." },
      { status: 500 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const submitted = (body as { passcode?: unknown })?.passcode;
  if (typeof submitted !== "string" || submitted !== passcode) {
    return NextResponse.json({ ok: false, error: "Incorrect passcode" }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE_NAME, "1", {
    // NOT httpOnly on purpose — the client only uses this to toggle UI
    // (show/hide a link), never to authorize anything server-side, so it's
    // fine (and simpler) for the browser to read it directly.
    httpOnly: false,
    sameSite: "lax",
    secure: true,
    maxAge: MAX_AGE_SECONDS,
    path: "/",
  });
  return res;
}

// Explicit "lock" action so leadership can clear the unlock immediately
// after using a shared iPad, rather than waiting out the 24h expiry.
export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE_NAME, "", { maxAge: 0, path: "/" });
  return res;
}
