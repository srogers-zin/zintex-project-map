// Fuzzy-matches a review author's name to a homeowner name on file for a
// project, so a Google/Birdeye review can be linked to the specific job it
// came from. Deliberately conservative: reviews don't carry a job ID, so a
// wrong match would misattribute a stranger's words to a real homeowner.
// When in doubt, this returns no match and the review just stays
// branch-level (the existing, safe behavior).

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
// one of a project's household name variants. Requires the last name to
// match exactly, plus either the first name matching or first-initial
// matching (reviews are sometimes posted as "Jane S." or just "Jane").
export function namesLikelyMatch(authorName: string, householdVariant: string[]): boolean {
  const author = normalizeName(authorName);
  if (author.length === 0 || householdVariant.length === 0) return false;

  const authorLast = author[author.length - 1];
  const houseLast = householdVariant[householdVariant.length - 1];
  if (!authorLast || !houseLast) return false;

  // Guard against single-letter "last names" (e.g. "Jane S.") matching a
  // full surname by coincidence of the first letter only.
  const lastMatches =
    authorLast === houseLast ||
    (authorLast.length === 1 && houseLast.startsWith(authorLast)) ||
    (houseLast.length === 1 && authorLast.startsWith(houseLast));
  if (!lastMatches) return false;

  if (author.length === 1 || householdVariant.length === 1) {
    // Only a last name (or single-token name) on one side — last-name match
    // within the same branch is our floor for confidence.
    return true;
  }

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

// Finds the best project match for a review within the same branch. Returns
// null if nothing looks confident enough. When multiple projects share a
// household name (e.g. two jobs for the same repeat customer), prefers the
// most recently created one via the caller's input order — pass projects
// already sorted newest-first.
export function matchReviewToProject(
  authorName: string,
  locationId: string,
  candidates: MatchableProject[],
): string | null {
  for (const p of candidates) {
    if (p.locationId !== locationId) continue;
    const variants = splitHouseholdNames(p.customerName);
    if (variants.some((v) => namesLikelyMatch(authorName, v))) {
      return p.id;
    }
  }
  return null;
}
