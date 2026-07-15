import type { Project, ProjectPhoto } from "@/lib/types";
import { BRANCHES, nearestBranchId, isInServiceArea } from "@/lib/branches";

// ---------------------------------------------------------------------------
// CompanyCam integration — sync skeleton.
//
// The TRANSFORM (raw CompanyCam project -> our Project + photos) is real and
// unit-testable. The API client is a thin interface with a live implementation
// that activates once COMPANYCAM_API_TOKEN is set (Open Question #1: confirm we
// have API access). Until then the sync script feeds fixtures through the same
// transform, so the data contract is proven before real credentials arrive.
// ---------------------------------------------------------------------------

// Shape of a CompanyCam project as returned by their REST API (subset we use).
// Ref: https://docs.companycam.com — confirm exact field names against the live
// API when access is granted; adjust the transform below if they differ.
export interface CompanyCamProject {
  id: string;
  name?: string;
  address?: {
    street_address_1?: string;
    city?: string;
    state?: string;
    postal_code?: string;
  };
  coordinates?: { lat: number; lon: number };
  status?: string;
  created_at?: number | string; // epoch seconds or ISO
  // CompanyCam "labels"/tags -> our service tags.
  labels?: Array<{ display_value: string }>;
  photos?: Array<{ id: string; uris?: Array<{ type: string; uri: string }> }>;
  photo_count?: number;
}

// A CompanyCam photo as returned by the photos endpoint (subset we use).
export interface CompanyCamPhoto {
  id: string;
  uris?: Array<{ type: string; uri: string }>;
}

export interface CompanyCamTag {
  id: string;
  display_value: string;
  value: string;
}

export interface CompanyCamClient {
  // Projects updated since `sinceIso`. Real impl paginates the CompanyCam API.
  listProjectsUpdatedSince(sinceIso: string | null): AsyncIterable<CompanyCamProject>;
  // Photos for one project (paginated internally). When the client was built
  // with photoTagIds, only photos carrying one of those tags are returned —
  // filtered server-side by CompanyCam, not fetched-then-checked locally.
  listPhotos(projectId: string): Promise<CompanyCamPhoto[]>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Fetch with retry/backoff on rate limits (429) and transient 5xx. Honors the
// Retry-After header when present. Essential for a 23k-project backfill.
async function ccFetch(url: URL | string, token: string, attempt = 0): Promise<Response> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if ((res.status === 429 || res.status >= 500) && attempt < 6) {
    const retryAfter = Number(res.headers.get("Retry-After"));
    const waitSec = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : Math.min(2 ** attempt, 30);
    await sleep(waitSec * 1000);
    return ccFetch(url, token, attempt + 1);
  }
  return res;
}

// Normalize a CompanyCam address object to a single line.
export function formatAddress(a: CompanyCamProject["address"]): string {
  if (!a) return "";
  return [a.street_address_1, a.city, a.state, a.postal_code]
    .filter(Boolean)
    .join(", ");
}

function toIso(v: CompanyCamProject["created_at"]): string {
  if (v == null) return new Date(0).toISOString();
  if (typeof v === "number") return new Date(v * 1000).toISOString();
  return new Date(v).toISOString();
}

// Pull the best display URI from a CompanyCam photo (prefer "original", else last).
function photoUrl(p: CompanyCamPhoto): string | null {
  if (!p.uris?.length) return null;
  const original = p.uris.find((u) => u.type === "original");
  return (original ?? p.uris[p.uris.length - 1]).uri;
}

// Transform CompanyCam photos (from the photos endpoint) into our model.
export function transformPhotos(projectId: string, raw: CompanyCamPhoto[]): ProjectPhoto[] {
  return raw
    .map((p, i) => {
      const url = photoUrl(p);
      return url ? { id: p.id, projectId, url, sortOrder: i } : null;
    })
    .filter((p): p is ProjectPhoto => p !== null);
}

export interface TransformResult {
  project: Project | null; // null when the project is not geocodable / not usable
  photos: ProjectPhoto[];
  skippedReason?: string;
}

// Pure transform: CompanyCam project -> our domain model. No I/O.
// Geocoding note: CompanyCam often returns coordinates directly. When absent,
// the real sync geocodes formatAddress() (Mapbox/Google) and caches the result.
export function transformProject(raw: CompanyCamProject): TransformResult {
  const address = formatAddress(raw.address);
  const lat = raw.coordinates?.lat;
  const lng = raw.coordinates?.lon;

  if (lat == null || lng == null) {
    return { project: null, photos: [], skippedReason: "missing coordinates (needs geocoding)" };
  }
  if (!address) {
    return { project: null, photos: [], skippedReason: "missing address" };
  }
  if (!isInServiceArea(raw.address?.state, lat, lng)) {
    return {
      project: null,
      photos: [],
      skippedReason: `outside service area (state: ${raw.address?.state || "unknown"})`,
    };
  }

  const tags = (raw.labels ?? [])
    .map((l) => l.display_value?.trim())
    .filter((v): v is string => Boolean(v));

  const photos: ProjectPhoto[] = (raw.photos ?? [])
    .map((p, i) => {
      const url = photoUrl(p);
      return url
        ? { id: p.id, projectId: raw.id, url, sortOrder: i }
        : null;
    })
    .filter((p): p is ProjectPhoto => p !== null);

  const project: Project = {
    id: raw.id,
    companycamProjectId: raw.id,
    address,
    lat,
    lng,
    locationId: nearestBranchId(lat, lng),
    tags,
    photoCount: raw.photo_count ?? photos.length,
    createdAt: toIso(raw.created_at),
    optedOut: false,
  };

  return { project, photos };
}

// Fetch every company tag (paginated) and resolve the given tag names to
// their numeric CompanyCam IDs. Matches case-insensitively against either
// display_value ("BATHS") or value (its lowercased form). Names that don't
// match anything are reported back separately so the caller can warn rather
// than silently sync nothing.
export async function resolveTagIds(
  token: string,
  names: string[],
  base = "https://api.companycam.com/v2",
): Promise<{ found: Map<string, string>; missing: string[] }> {
  const wanted = new Set(names.map((n) => n.trim().toLowerCase()));
  const found = new Map<string, string>(); // requested name (lowercased) -> id
  let page = 1;
  const PER_PAGE = 100;
  for (;;) {
    const url = new URL(`${base}/tags`);
    url.searchParams.set("page", String(page));
    url.searchParams.set("per_page", String(PER_PAGE));
    const res = await ccFetch(url, token);
    if (!res.ok) throw new Error(`CompanyCam API ${res.status} on tags p${page}: ${await res.text()}`);
    const batch = (await res.json()) as CompanyCamTag[];
    if (!batch.length) break;
    for (const tag of batch) {
      const dv = tag.display_value?.trim().toLowerCase();
      const v = tag.value?.trim().toLowerCase();
      for (const want of wanted) {
        if (want === dv || want === v) found.set(want, tag.id);
      }
    }
    if (found.size === wanted.size) break; // all resolved, no need to keep paging
    page += 1;
  }
  const missing = [...wanted].filter((w) => !found.has(w));
  return { found, missing };
}

// Live client — only constructed when a token is present.
// NOTE: endpoint paths, pagination params, and field names below are per the
// CompanyCam v2 REST API and should be confirmed against the live docs on first
// run (they're isolated here, so any tweak is a one-line change).
export function createLiveClient(
  token: string,
  base = "https://api.companycam.com/v2",
  photoTagIds?: string[],
): CompanyCamClient {
  const PER_PAGE = 100;
  return {
    async *listProjectsUpdatedSince(sinceIso) {
      // NOTE: CompanyCam's /projects endpoint silently caps per_page below what
      // we request (observed: asking for 100 still returns pages of exactly 50,
      // consistently, page after page), unlike what the docs imply. Relying on
      // "batch.length < requested per_page" to detect the last page was wrong —
      // it triggered on page 1 every time and silently dropped everything after
      // it. The only reliable end-of-data signal is a truly empty page.
      let page = 1;
      for (;;) {
        const url = new URL(`${base}/projects`);
        url.searchParams.set("page", String(page));
        url.searchParams.set("per_page", String(PER_PAGE));
        if (sinceIso) url.searchParams.set("modified_since", sinceIso);

        const res = await ccFetch(url, token);
        if (!res.ok) {
          const errBody = await res.text();
          // CompanyCam enforces a hard "max offset" cap on this endpoint (seen:
          // 400 "The max offset for Projects is 10000") — this is a real,
          // permanent platform limit, not a transient error. Since projects are
          // sorted "most recent activity first", this means only the most
          // recently active ~10,000 projects are reachable via plain pagination;
          // anything older needs a different export mechanism from CompanyCam
          // (ask their support about a bulk/historical export, or whether an
          // undocumented cursor/sort param exists for this account). Stop
          // cleanly here so everything already fetched still gets saved, rather
          // than throwing and losing the whole run.
          if (res.status === 400 && /max offset/i.test(errBody)) {
            console.warn(
              `CompanyCam's /projects endpoint hit its max-offset limit at page ${page} ` +
                `(offset ${(page - 1) * PER_PAGE}). Stopping here — everything fetched so far will ` +
                `still be saved. This is a platform limit, not a bug; see the comment above this line.`,
            );
            return;
          }
          throw new Error(`CompanyCam API ${res.status} on projects p${page}: ${errBody}`);
        }
        const batch = (await res.json()) as CompanyCamProject[];
        if (!batch.length) return; // truly empty page = done
        for (const p of batch) yield p;
        page += 1;
      }
    },

    async listPhotos(projectId) {
      const all: CompanyCamPhoto[] = [];
      let page = 1;
      for (;;) {
        const url = new URL(`${base}/projects/${projectId}/photos`);
        url.searchParams.set("page", String(page));
        url.searchParams.set("per_page", String(PER_PAGE));
        // Server-side tag filter (CompanyCam ANDs nothing here — it's OR across
        // the given ids), so we only ever pull photos already tagged BATHS,
        // WINDOWS, "PMI - Pin already on map", or "PMI Featured Photo" instead
        // of downloading every field photo and filtering client-side.
        //
        // IMPORTANT: this must be bracket notation (tag_ids[]=1&tag_ids[]=2),
        // not repeated plain keys (tag_ids=1&tag_ids=2). CompanyCam's API is
        // Rails-based, and Rails only treats repeated *bracketed* keys as an
        // array — plain repeated keys just silently overwrite each other, so
        // the server only ever saw the LAST tag id instead of all four. That
        // caused a real sync to come back with "Photos: 1 total" instead of
        // the expected tens of thousands — it was filtering on one tag, not
        // the four requested.
        for (const id of photoTagIds ?? []) url.searchParams.append("tag_ids[]", id);

        const res = await ccFetch(url, token);
        if (!res.ok) throw new Error(`CompanyCam API ${res.status} on photos for ${projectId}: ${await res.text()}`);
        const batch = (await res.json()) as CompanyCamPhoto[];
        if (!batch.length) return all; // truly empty page = done
        all.push(...batch);
        page += 1;
      }
    },
  };
}

// Sanity re-export so scripts can reference the branch list from one place.
export { BRANCHES };
