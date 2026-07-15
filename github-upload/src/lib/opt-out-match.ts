// Shared, deliberately conservative address-matching rule for opt-out
// suppression.
//
// Incident this exists to prevent: a single opt-out request was submitted
// with just "Abilene" (no street address) instead of a real address. The old
// matching logic did a loose substring check against the FULL formatted
// address ("street, city, state, zip"), so that one vague entry silently
// suppressed all 72 real projects in Abilene, TX — an entire branch's worth
// of legitimate customer work vanished from the map because of one bad
// entry. An opt-out request should only ever be able to suppress the ONE
// property it actually names.
//
// Rules:
//  - An exact match on a project's id or CompanyCam project id always
//    matches, regardless of format — that's unambiguous and safe.
//  - An address-based match must be EXACT (not "contains"), and is checked
//    against the address's STREET LINE ONLY, never the full
//    "street, city, state, zip" string — matching the full string would let
//    one entry opt out an entire city or state.
//  - A needle with no digit in it is never allowed to match by address at
//    all, even exactly. Real street addresses almost always start with a
//    house number; bare city/state names don't, and must never suppress
//    anything.

export function normalizeText(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

export function streetLine(address: string): string {
  return normalizeText(address.split(",")[0] ?? "");
}

export function looksLikeAddress(needle: string): boolean {
  return /\d/.test(needle);
}

export function matchesOptOut(
  project: { id: string; companycamProjectId?: string; address: string },
  rawNeedle: string,
): boolean {
  const needle = normalizeText(rawNeedle);
  if (!needle) return false;

  if (project.id.toLowerCase() === needle) return true;
  if (project.companycamProjectId && project.companycamProjectId.toLowerCase() === needle) return true;

  if (!looksLikeAddress(needle)) return false; // bare city/state names never match

  const full = normalizeText(project.address);
  if (full === needle) return true;
  if (streetLine(project.address) === needle) return true;

  return false;
}
