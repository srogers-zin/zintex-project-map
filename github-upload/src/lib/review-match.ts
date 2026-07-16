// Fuzzy-matches a review author's name to a homeowner name on file for a
// project, so a Google/Birdeye review can be linked to the specific job it
// came from. Deliberately conservative: reviews don't carry a job ID, so a
// wrong match would misattribute a stranger's words to a real homeowner.
// When in doubt, this returns no match and the review just stays
// branch-level (the existing, safe behavior).
//
// Matching is done nationally (not scoped to a branch): Birdeye's
// sub-location breakdown ("Hutto, TX", "Tulsa, OK", "Wichita, KS", ...)
// doesn't line up cleanly with our 8 branch offices, so instead of trying to
// map one to the other, this requires a confident first+last name match
// across the whole customer base. A full-name match is specific enough on
// its own; a bare last-name match would not be, so that's not accepted here.

// Common suffixes/titles that show up in either CRM names or review-site
// display names but shouldn't affect matching.
const STRIP_TOKENS = new Set([
  "mr", "mrs", "ms", "mx", "dr", "jr", "sr", "ii", "iii", "iv",
]);

export function normalizeName(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .toLowerCase()
    .replace(/[^a-z\s'-]/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0 && !STRIP_TOKENS.has(t));
}

// A project's `customerName` (from PMI's `name` / `surveyNames` fields)
// sometimes holds a couple, e.g. "John & Jane Smith" or "Smith Family" — so
// split on common separators before normalizing.
export function splitHouseholdNames(raw: string | null | undefined): string[][] {
  if (!raw) return [];
  return raw
    .split(/&|\band\b|\/|,/i)
    .map((part) => normalizeName(part))
    .filter((tokens) => tokens.length > 0);
}

// True if the review author's name plausibly refers to the same person as
// one of a project's household name variants. Requires a full first+last
// match (or first-initial vs. first-name match, since reviews are sometimes
// posted as "Jane S." — but always requires the last name to match too).
export function namesLikelyMatch(authorName: string, householdVariant: string[]): boolean {
  const author = normalizeName(authorName);
  if (author.length < 2 || householdVariant.length < 2) return false; // need both first + last

  const authorLast = author[author.length - 1];
  const houseLast = householdVariant[householdVariant.length - 1];
  if (!authorLast || !houseLast) return false;

  const lastMatches =
    authorLast === houseLast ||
    (authorLast.length === 1 && houseLast.startsWith(authorLast)) ||
    (houseLast.length === 1 && authorLast.startsWith(houseLast));
  if (!lastMatches) return false;

  const authorFirst = author[0];
  const houseFirst = householdVariant[0];
  if (authorFirst === houseFirst) return true;
  if (authorFirst[0] === houseFirst[0]) return true; // "J." vs "Jane"

  return false;
}

export interface MatchableProject {
  id: string;
  locationId: string;
  customerName?: string | null;
}

// Finds the best project match for a review across the whole customer base
// (see file header for why this isn't scoped to a branch). Returns null if
// nothing looks confident enough. When multiple projects share a household
// name (e.g. a repeat customer, or a coincidental same name in a different
// city), prefers whichever comes first — pass candidates already sorted
// newest-first so a repeat customer's most recent job wins.
export function matchReviewToProject(
  authorName: string,
  candidates: MatchableProject[],
): string | null {
  for (const p of candidates) {
    const variants = splitHouseholdNames(p.customerName);
    if (variants.some((v) => namesLikelyMatch(authorName, v))) {
      return p.id;
    }
  }
  return null;
}
