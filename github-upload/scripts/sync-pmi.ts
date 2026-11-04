import { promises as fs } from "node:fs";
import path from "node:path";

// Load .env.local so PMI_API_TOKEN is picked up here too (tsx doesn't
// auto-load env files the way the Next.js app does). Keep the token in
// .env.local (gitignored) rather than passing it inline.
try {
  (process as unknown as { loadEnvFile: (p: string) => void }).loadEnvFile(
    path.join(process.cwd(), ".env.local"),
  );
} catch {
  /* no .env.local yet — fine */
}

import { isInServiceArea, nearestBranchId } from "../src/lib/branches";
import type { Project, ProjectPhoto } from "../src/lib/types";
import { matchesOptOut } from "../src/lib/opt-out-match";

// ===========================================================================
// Project Map It (legacy platform) → this app's data store.
//
// This is the one-time (and repeatable) historical pull that replaces the
// CompanyCam sync as the map's primary data source. Two things make this much
// simpler than the CompanyCam sync:
//   1. No 10,000-row offset cap — this is a normal page-based listing, so all
//      23k+ projects are actually reachable.
//   2. Photos come back nested directly on each project in the list response
//      (confirmed via scripts/pmi-explore.ts) — no second per-project photo
//      fetch/concurrency pool needed like CompanyCam required.
//
//   PMI_API_TOKEN=xxx npm run sync:pmi                  # full pull
//   PMI_API_TOKEN=xxx npm run sync:pmi -- --limit 50     # smoke test
// ===========================================================================

const DATA_DIR = path.join(process.cwd(), "data");
const OPTOUTS_FILE = path.join(DATA_DIR, "opt-outs.json");
const PER_PAGE = 100; // documented max for this endpoint
const PROGRESS_EVERY = 1000;

interface Args {
  limit: number | null;
}
function parseArgs(argv: string[]): Args {
  const limitIdx = argv.indexOf("--limit");
  return { limit: limitIdx >= 0 ? Number(argv[limitIdx + 1]) : null };
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Fetch with retry/backoff on rate limits (429) and transient 5xx, same
// pattern used for the CompanyCam sync.
async function pmiFetch(url: string, token: string, attempt = 0): Promise<Response> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if ((res.status === 429 || res.status >= 500) && attempt < 6) {
    const retryAfter = Number(res.headers.get("Retry-After"));
    const waitSec = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : Math.min(2 ** attempt, 30);
    await sleep(waitSec * 1000);
    return pmiFetch(url, token, attempt + 1);
  }
  return res;
}

// Shapes per scripts/pmi-explore.ts (subset of fields we actually use).
interface PmiPhoto {
  _id: string;
  path?: { small?: string; large?: string };
  order?: number;
  published?: boolean;
}
interface PmiProject {
  _id: string;
  companycam_id?: string;
  state?: string;
  city?: string;
  street?: string;
  normalized_address?: string;
  active?: boolean;
  location?: [number, number]; // [lng, lat]
  categories?: Array<{ name: string }>;
  photos?: PmiPhoto[];
  created?: string;
  // Internal project name (per PMI docs: "for internal identification, not
  // shown to the public") and the survey recipient name(s) — both are
  // typically the homeowner's name. Kept out of the public Project type
  // (see ProjectDetail in src/lib/types.ts) and used only to fuzzy-match
  // Google/Birdeye reviews to a project (scripts/sync-birdeye-reviews.ts).
  name?: string;
  surveyNames?: string[];
}
interface PmiListResponse {
  page: number;
  pages: number;
  perPage: number;
  totalCount: number;
  results: PmiProject[];
}

async function* listAllProjects(token: string, base: string): AsyncIterable<PmiProject> {
  let page = 1;
  for (;;) {
    const url = new URL(`${base}/api/v1/projects`);
    url.searchParams.set("limit", String(PER_PAGE));
    url.searchParams.set("page", String(page));
    const res = await pmiFetch(url.toString(), token);
    if (!res.ok) throw new Error(`PMI API ${res.status} on projects p${page}: ${await res.text()}`);
    const body = (await res.json()) as PmiListResponse;
    if (!body.results?.length) return; // truly empty page = done
    for (const p of body.results) yield p;
    if (page >= (body.pages ?? page)) return;
    page += 1;
  }
}

// Pure transform: PMI project -> our domain model. Mirrors the CompanyCam
// transform's shape/skip-reason conventions so the rest of the pipeline
// (opt-outs, fixtures writer) doesn't need to change.
function transformPmiProject(raw: PmiProject): {
  project: Project | null;
  photos: ProjectPhoto[];
  skippedReason?: string;
} {
  if (!raw.active) {
    return { project: null, photos: [], skippedReason: "not active/public in PMI" };
  }
  const lng = raw.location?.[0];
  const lat = raw.location?.[1];
  if (lat == null || lng == null) {
    return { project: null, photos: [], skippedReason: "missing coordinates" };
  }
  const address = raw.normalized_address || [raw.street, raw.city, raw.state].filter(Boolean).join(", ");
  if (!address) {
    return { project: null, photos: [], skippedReason: "missing address" };
  }
  if (!isInServiceArea(raw.state, lat, lng)) {
    return { project: null, photos: [], skippedReason: `outside service area (state: ${raw.state || "unknown"})` };
  }

  // Respect PMI's own publish flag — this is the curation the team already
  // did in the old tool, so it's the closest thing to "vetted for public
  // display" we have. Treat a missing `published` field as visible (some
  // older records may predate that field) but always require a usable URL.
  const publishedPhotos = (raw.photos ?? [])
    .filter((p) => p.published !== false && p.path?.large)
    .sort((a, b) => (a.order ?? 999999) - (b.order ?? 999999));

  const photos: ProjectPhoto[] = publishedPhotos.map((p, i) => ({
    id: p._id,
    projectId: raw._id,
    url: p.path!.large!,
    sortOrder: i,
  }));

  // Prefer surveyNames (explicitly the person the survey/review request went
  // to) over the internal project `name`, which is sometimes a job
  // description ("Smith Bathroom Remodel") rather than a bare name — still
  // useful for matching since it contains the surname either way.
  const customerName = (raw.surveyNames && raw.surveyNames[0]) || raw.name || null;

  const project: Project = {
    id: raw._id,
    companycamProjectId: raw.companycam_id || raw._id,
    address,
    lat,
    lng,
    locationId: nearestBranchId(lat, lng),
    tags: (raw.categories ?? []).map((c) => c.name).filter(Boolean),
    photoCount: photos.length,
    createdAt: raw.created ?? new Date(0).toISOString(),
    optedOut: false,
    customerName,
  };

  return { project, photos };
}

async function applyOptOuts(projects: Project[]): Promise<number> {
  const optOuts = await readJson<Array<{ addressOrProjectId: string }>>(OPTOUTS_FILE, []);
  if (!optOuts.length) return 0;
  let count = 0;
  for (const p of projects) {
    const hit = optOuts.some((o) => matchesOptOut(p, o.addressOrProjectId));
    if (hit && !p.optedOut) {
      p.optedOut = true;
      count++;
    }
  }
  return count;
}

// Upserts rather than replacing outright, same rationale as
// sync-companycam.ts's writeFixtures: once PMI's contract ends this is the
// only remaining source for these ~23k historical projects, so this file
// should never again be capable of destroying them by accident (e.g. an
// interrupted/partial future run).
async function writeFixtures(projects: Project[], photos: ProjectPhoto[]) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const existingP = await readJson<Project[]>(path.join(DATA_DIR, "projects.json"), []);
  const existingPh = await readJson<ProjectPhoto[]>(path.join(DATA_DIR, "photos.json"), []);

  const pById = new Map(existingP.map((p) => [p.id, p]));
  for (const p of projects) pById.set(p.id, p);
  const syncedIds = new Set(projects.map((p) => p.id));
  const mergedPhotos = existingPh.filter((ph) => !syncedIds.has(ph.projectId)).concat(photos);

  await fs.writeFile(path.join(DATA_DIR, "projects.json"), JSON.stringify([...pById.values()], null, 2));
  await fs.writeFile(path.join(DATA_DIR, "photos.json"), JSON.stringify(mergedPhotos, null, 2));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const token = process.env.PMI_API_TOKEN;
  if (!token) {
    console.error("PMI_API_TOKEN not set in .env.local — nothing to sync.");
    process.exit(1);
  }
  const base = process.env.PMI_API_BASE || "https://projectmapit.com";

  console.log(`Project Map It (legacy platform) sync`);
  console.log(`  source: LIVE (${base})`);
  console.log(`  target: fixtures (data/*.json)`);
  if (args.limit) console.log(`  limit:  ${args.limit} (smoke test)`);

  const projects: Project[] = [];
  const photos: ProjectPhoto[] = [];
  let scanned = 0;
  let skipped = 0;

  for await (const raw of listAllProjects(token, base)) {
    scanned++;
    const { project, photos: pPhotos, skippedReason } = transformPmiProject(raw);
    if (!project) {
      skipped++;
      if (skipped <= 10) console.warn(`  skip ${raw._id}: ${skippedReason}`);
      continue;
    }
    projects.push(project);
    photos.push(...pPhotos);
    if (projects.length % PROGRESS_EVERY === 0) {
      console.log(`  …${projects.length} projects (${photos.length} photos so far)`);
    }
    if (args.limit && projects.length >= args.limit) break;
  }
  console.log(`Projects: ${projects.length} kept, ${skipped} skipped (of ${scanned} scanned).`);
  console.log(`Photos: ${photos.length} total.`);

  const suppressed = await applyOptOuts(projects);
  if (suppressed) console.log(`Opt-outs: suppressed ${suppressed} project(s).`);

  await writeFixtures(projects, photos);
  console.log(`Merged ${projects.length} synced projects (+ ${photos.length} photos) into data/*.json.`);
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
