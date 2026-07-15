import { promises as fs } from "node:fs";
import path from "node:path";

// Load .env.local so COMPANYCAM_API_TOKEN / DATABASE_URL / DATA_SOURCE are picked
// up here too (tsx doesn't auto-load env files the way the Next.js app does).
// Keep the token in .env.local (gitignored) rather than passing it inline, so it
// never lands in shell history.
try {
  (process as unknown as { loadEnvFile: (p: string) => void }).loadEnvFile(
    path.join(process.cwd(), ".env.local"),
  );
} catch {
  /* no .env.local yet — fine */
}

import {
  createLiveClient,
  resolveTagIds,
  transformProject,
  transformPhotos,
  type CompanyCamClient,
  type CompanyCamPhoto,
  type CompanyCamProject,
} from "../src/lib/companycam";
import type { Project, ProjectPhoto } from "../src/lib/types";
import { matchesOptOut } from "../src/lib/opt-out-match";

// Only photos carrying one of these tags get pulled into the map — everything
// else a field rep shot (rough progress shots, interior mess, etc.) stays out
// of the public gallery. "PMI - Pin already on map" / "PMI Featured Photo" are
// carried over from how the team already tags photos for the old Project Map
// It tool; BATHS/WINDOWS are the service-type tags; "Before and After" and
// "100% Satisfied" were added to widen coverage beyond the original 4 tags
// (~1.7% of projects had a match). Edit this list directly if the tagging
// convention changes again.
// Note: matching against CompanyCam is case-insensitive (see resolveTagIds),
// so exact casing here is just for readability, not functionality.
const PHOTO_TAG_NAMES = [
  "Baths",
  "windows",
  "PMI - Pin already on map",
  "PMI Featured Photo",
  "Before and After",
  "100% Satisfied",
  "GBP",
  "Jacuzzi Deluxe Shower System",
];

// ===========================================================================
// CompanyCam → Project Map It sync.
//
// Pulls projects (and their photos) from the CompanyCam API and writes them to
// the active data store. Built for the full 23k-project backfill: rate-limit
// backoff, incremental sync, photo concurrency, opt-out enforcement, progress.
//
//   COMPANYCAM_API_TOKEN=xxx npm run sync:companycam            # full/incremental
//   COMPANYCAM_API_TOKEN=xxx npm run sync:companycam -- --limit 50   # smoke test
//   COMPANYCAM_API_TOKEN=xxx npm run sync:companycam -- --full        # ignore state
//   COMPANYCAM_API_TOKEN=xxx npm run sync:companycam -- --projects-only
//
// Target store follows DATA_SOURCE:
//   fixtures (default) -> writes data/projects.json + data/photos.json
//   postgres           -> upserts into Postgres/PostGIS (needs DATABASE_URL)
//
// First run tip: start with `--limit 50` to confirm the CompanyCam field
// mapping against live data before committing to the full pull.
// ===========================================================================

const DATA_DIR = path.join(process.cwd(), "data");
const STATE_FILE = path.join(DATA_DIR, "sync-state.json");
const OPTOUTS_FILE = path.join(DATA_DIR, "opt-outs.json");
const PHOTO_CONCURRENCY = 6;
const PROGRESS_EVERY = 500;

interface Args {
  full: boolean;
  projectsOnly: boolean;
  limit: number | null;
}
function parseArgs(argv: string[]): Args {
  const limitIdx = argv.indexOf("--limit");
  return {
    full: argv.includes("--full"),
    projectsOnly: argv.includes("--projects-only"),
    limit: limitIdx >= 0 ? Number(argv[limitIdx + 1]) : null,
  };
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

// Run `fn` over items with a fixed concurrency ceiling (for photo fetches).
async function mapPool<T, R>(items: T[], concurrency: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  async function worker() {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

// Cross-reference the homeowner opt-out suppression list. This is a hard
// requirement — suppressed addresses must never be published. See
// src/lib/opt-out-match.ts for why this uses exact street-address matching
// rather than a loose "contains" check (a single vague entry like "Abilene"
// must never be able to suppress an entire city's worth of real projects).
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

// --- Sinks -----------------------------------------------------------------

async function writeFixtures(projects: Project[], photos: ProjectPhoto[], incremental: boolean) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  if (incremental) {
    // Upsert into existing fixtures by id.
    const existingP = await readJson<Project[]>(path.join(DATA_DIR, "projects.json"), []);
    const existingPh = await readJson<ProjectPhoto[]>(path.join(DATA_DIR, "photos.json"), []);
    const pById = new Map(existingP.map((p) => [p.id, p]));
    for (const p of projects) pById.set(p.id, p);
    const syncedIds = new Set(projects.map((p) => p.id));
    const mergedPhotos = existingPh.filter((ph) => !syncedIds.has(ph.projectId)).concat(photos);
    projects = [...pById.values()];
    photos = mergedPhotos;
  }
  await fs.writeFile(path.join(DATA_DIR, "projects.json"), JSON.stringify(projects, null, 2));
  await fs.writeFile(path.join(DATA_DIR, "photos.json"), JSON.stringify(photos, null, 2));
}

async function writePostgres(projects: Project[], photos: ProjectPhoto[]) {
  const { Pool } = await import("pg");
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required when DATA_SOURCE=postgres");
  const pool = new Pool({ connectionString: url, max: 8 });
  const photosByProject = new Map<string, ProjectPhoto[]>();
  for (const ph of photos) {
    const list = photosByProject.get(ph.projectId) ?? [];
    list.push(ph);
    photosByProject.set(ph.projectId, list);
  }
  try {
    for (const p of projects) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const up = await client.query(
          `INSERT INTO projects (companycam_project_id, address, geom, location_id, tags, photo_count, created_at, opted_out, updated_at)
           VALUES ($1,$2, ST_SetSRID(ST_MakePoint($3,$4),4326)::geography, $5,$6,$7,$8,$9, now())
           ON CONFLICT (companycam_project_id) DO UPDATE SET
             address=EXCLUDED.address, geom=EXCLUDED.geom, location_id=EXCLUDED.location_id,
             tags=EXCLUDED.tags, photo_count=EXCLUDED.photo_count, opted_out=EXCLUDED.opted_out, updated_at=now()
           RETURNING id`,
          [p.companycamProjectId, p.address, p.lng, p.lat, p.locationId, p.tags, p.photoCount, p.optedOut],
        );
        const projectId = up.rows[0].id as string;
        const projPhotos = photosByProject.get(p.id) ?? [];
        await client.query(`DELETE FROM project_photos WHERE project_id = $1`, [projectId]);
        for (const ph of projPhotos) {
          await client.query(
            `INSERT INTO project_photos (project_id, companycam_photo_url, sort_order) VALUES ($1,$2,$3)`,
            [projectId, ph.url, ph.sortOrder],
          );
        }
        await client.query("COMMIT");
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
    }
  } finally {
    await pool.end();
  }
}

// --- Fixture client (no token) ---------------------------------------------
// Replays CompanyCam-shaped samples through the SAME transform, so the pipeline
// is exercised end-to-end without credentials.
function fixtureClient(): CompanyCamClient {
  const samples: CompanyCamProject[] = [
    {
      id: "cc-sample-1",
      name: "Johnson Bathroom Remodel",
      address: { street_address_1: "1420 Oak St", city: "Abilene", state: "TX", postal_code: "79601" },
      coordinates: { lat: 32.4487, lon: -99.7331 },
      created_at: 1735689600,
      labels: [{ display_value: "Baths" }, { display_value: "Windows" }],
      photo_count: 2,
    },
    {
      id: "cc-sample-2",
      name: "Missing coords (should be geocoded)",
      address: { street_address_1: "55 Ridge Rd", city: "Lubbock", state: "TX" },
      created_at: "2026-02-01T00:00:00Z",
      labels: [{ display_value: "Roofing" }],
    },
  ];
  const photos: Record<string, CompanyCamPhoto[]> = {
    "cc-sample-1": [
      { id: "p1", uris: [{ type: "original", uri: "https://picsum.photos/seed/cc-sample-1-0/900/675" }] },
      { id: "p2", uris: [{ type: "original", uri: "https://picsum.photos/seed/cc-sample-1-1/900/675" }] },
    ],
  };
  return {
    async *listProjectsUpdatedSince() {
      for (const s of samples) yield s;
    },
    async listPhotos(projectId) {
      return photos[projectId] ?? [];
    },
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const token = process.env.COMPANYCAM_API_TOKEN;
  const target = process.env.DATA_SOURCE === "postgres" ? "postgres" : "fixtures";

  let photoTagIds: string[] = [];
  if (token) {
    console.log(`Resolving photo tags: ${PHOTO_TAG_NAMES.join(", ")}`);
    const { found, missing } = await resolveTagIds(token, PHOTO_TAG_NAMES, process.env.COMPANYCAM_API_BASE);
    photoTagIds = [...found.values()];
    if (missing.length) {
      console.warn(
        `  WARNING: could not find these tags in CompanyCam (check spelling/casing in the app): ${missing.join(", ")}`,
      );
    }
    if (!photoTagIds.length) {
      console.warn(
        `  WARNING: none of the requested photo tags exist yet — no photos will be pulled until at least one does.`,
      );
    } else {
      console.log(`  resolved ${photoTagIds.length}/${PHOTO_TAG_NAMES.length} tag(s).`);
    }
  }
  const client = token
    ? createLiveClient(token, process.env.COMPANYCAM_API_BASE, photoTagIds)
    : fixtureClient();

  const state = await readJson<{ lastSyncIso: string | null }>(STATE_FILE, { lastSyncIso: null });
  const sinceIso = args.full ? null : state.lastSyncIso;
  const startedAt = new Date().toISOString();

  console.log(`CompanyCam sync`);
  console.log(`  source:  ${token ? "LIVE" : "FIXTURE (no token — set COMPANYCAM_API_TOKEN)"}`);
  console.log(`  target:  ${target}${target === "fixtures" ? " (data/*.json)" : " (Postgres)"}`);
  console.log(`  mode:    ${sinceIso ? `incremental since ${sinceIso}` : "full backfill"}`);
  if (args.limit) console.log(`  limit:   ${args.limit} (smoke test)`);

  // 1) Pull + transform projects (streamed, paginated).
  const projects: Project[] = [];
  let scanned = 0;
  let skipped = 0;
  for await (const raw of client.listProjectsUpdatedSince(sinceIso)) {
    scanned++;
    const { project, skippedReason } = transformProject(raw);
    if (!project) {
      skipped++;
      // TODO(geocode): when skippedReason is missing coordinates, geocode
      // formatAddress(raw.address) via the configured provider and retry.
      if (skipped <= 10) console.warn(`  skip ${raw.id}: ${skippedReason}`);
      continue;
    }
    projects.push(project);
    if (projects.length % PROGRESS_EVERY === 0) console.log(`  …${projects.length} projects`);
    if (args.limit && projects.length >= args.limit) break;
  }
  console.log(`Projects: ${projects.length} kept, ${skipped} skipped (of ${scanned} scanned).`);

  // 2) Fetch photos (concurrency-limited, already tag-filtered server-side by
  //    CompanyCam) for projects that have at least one photo at all. Note:
  //    p.photoCount currently holds CompanyCam's raw total photo count, which
  //    is only used here as a cheap pre-filter (0 photos total means 0 tagged
  //    photos too, no point calling). It gets corrected below to the real,
  //    tag-filtered count once we know it.
  const photos: ProjectPhoto[] = [];
  if (!args.projectsOnly) {
    if (token && !photoTagIds.length) {
      console.warn(`Skipping photo fetch entirely — no photo tags resolved (see warning above).`);
    } else {
      const withPhotos = projects.filter((p) => p.photoCount > 0);
      console.log(`Fetching photos for ${withPhotos.length} projects (concurrency ${PHOTO_CONCURRENCY})…`);
      let done = 0;
      await mapPool(withPhotos, PHOTO_CONCURRENCY, async (p) => {
        try {
          const raw = await client.listPhotos(p.companycamProjectId);
          const transformed = transformPhotos(p.id, raw);
          p.photoCount = transformed.length; // correct to the tag-filtered count
          photos.push(...transformed);
        } catch (e) {
          console.warn(`  photo fetch failed for ${p.id}: ${(e as Error).message}`);
        }
        if (++done % PROGRESS_EVERY === 0) console.log(`  …${done}/${withPhotos.length} photo sets`);
      });
      console.log(`Photos: ${photos.length} total.`);
    }
  } else {
    console.log(`Skipping photo fetch (--projects-only). photo_count still reflects CompanyCam's raw total.`);
  }

  // 3) Enforce opt-outs.
  const suppressed = await applyOptOuts(projects);
  if (suppressed) console.log(`Opt-outs: suppressed ${suppressed} project(s).`);

  // 4) Write to the active store.
  const incremental = !!sinceIso;
  if (target === "postgres") {
    await writePostgres(projects, photos);
    console.log(`Upserted ${projects.length} projects + ${photos.length} photos into Postgres.`);
  } else {
    await writeFixtures(projects, photos, incremental);
    console.log(`Wrote ${projects.length} projects + ${photos.length} photos to data/*.json.`);
  }

  // 5) Persist sync state (skip on smoke tests so they don't advance the cursor).
  if (!args.limit) {
    await fs.writeFile(STATE_FILE, JSON.stringify({ lastSyncIso: startedAt }, null, 2));
    console.log(`Sync state updated → ${startedAt}`);
  }
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
