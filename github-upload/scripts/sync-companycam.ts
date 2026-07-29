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

// These two tags are how the team marks a CompanyCam photo for the public
// map going forward (the ongoing replacement for tagging in the old Project
// Map It tool now that PMI is being retired). Exact wording confirmed
// against the real tags in CompanyCam — must match precisely (matching is
// case-insensitive, per resolveTagIds, but not fuzzy otherwise):
//   "PMI - Pin already on map" — the project this photo belongs to is
//                                already on the map (from the historical PMI
//                                import). Just add this newly tagged photo
//                                to that existing project — don't create a
//                                second pin for it.
//   "PMI Featured Photo"       — feature this specific photo. The project
//                                may or may not already be on the map;
//                                create it (address, coordinates, etc.) if
//                                it isn't yet.
//   "Baths"                    — service-type tag, added to widen coverage
//                                to bathroom-remodel photos generally, not
//                                just ones explicitly marked for PMI.
// Functionally these three behave identically in this script: whichever tag
// is present, the tagged photo gets pulled in and its project gets upserted —
// writeFixtures' existing companycamProjectId dedup (below) is what makes
// "already on the map" reuse the existing pin instead of duplicating it,
// and makes "not on the map yet" create a fresh one. No other project or
// photo gets pulled in — a project with zero tagged photos does not appear
// on the map at all, no matter how much other CompanyCam activity it has.
const PHOTO_TAG_NAMES = ["PMI - Pin already on map", "PMI Featured Photo", "Baths"];

// Toggle between the two photo-selection strategies:
//   "tags" — opt-in (current default). Only photos carrying one of
//            PHOTO_TAG_NAMES get pulled, AND a project only appears on the
//            map at all if it has at least one such tagged photo (see main()
//            below — untagged/unmatched projects are dropped entirely, not
//            just photo-less).
//   "all"  — pulls every photo for every project CompanyCam returns,
//            regardless of tags, and includes every project regardless of
//            whether it has any photos. Not used currently, kept for
//            reference / in case the tagging convention changes again.
const PHOTO_FILTER_MODE: "tags" | "all" = "tags";

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

// ALWAYS upsert into the existing fixtures — never wholesale-replace them,
// full backfill or not. This matters a lot now that data/projects.json also
// holds ~23k historical projects pulled from the (soon to be canceled) legacy
// Project Map It platform (see scripts/sync-pmi.ts): CompanyCam's /projects
// endpoint has a hard 10,000-row offset cap, so a CompanyCam sync can never
// rediscover those older projects on its own. A destructive overwrite here
// would silently delete most of the map's history.
//
// Also dedupes CompanyCam projects against PMI-sourced ones that represent
// the SAME physical project. PMI records carry a companycam_id cross-
// reference (raw.companycam_id, stored here as companycamProjectId) — if an
// incoming CompanyCam project matches an existing entry's
// companycamProjectId, it updates that existing record in place (keeping its
// original id) instead of inserting a second pin at the same address.
async function writeFixtures(projects: Project[], photos: ProjectPhoto[]) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const existingP = await readJson<Project[]>(path.join(DATA_DIR, "projects.json"), []);
  const existingPh = await readJson<ProjectPhoto[]>(path.join(DATA_DIR, "photos.json"), []);

  const pById = new Map(existingP.map((p) => [p.id, p]));
  const idByCompanyCamId = new Map(
    existingP.filter((p) => p.companycamProjectId).map((p) => [p.companycamProjectId, p.id]),
  );

  const resolvedIds: string[] = []; // ids actually touched by this sync, for the photo merge below
  for (const incoming of projects) {
    const existingIdForSameCcProject = idByCompanyCamId.get(incoming.companycamProjectId);
    const targetId = existingIdForSameCcProject ?? incoming.id;
    // Spread the EXISTING record first, then incoming — so fields the
    // CompanyCam transform never sets (e.g. `customerName`, the PMI
    // homeowner name used for Birdeye review matching) survive the merge
    // instead of silently disappearing. Previously this was `{ ...incoming,
    // id: targetId }` with no existing spread at all, which meant every time
    // a CompanyCam sync touched a project that started life as a PMI record,
    // it quietly wiped that project's customerName — breaking future review
    // matching for that homeowner. Fixed here.
    const existingRecord = pById.get(targetId);
    pById.set(targetId, { ...existingRecord, ...incoming, id: targetId });
    idByCompanyCamId.set(incoming.companycamProjectId, targetId);
    resolvedIds.push(targetId);
  }

  // Photos need the same id remap when an incoming project collapsed onto an
  // existing PMI-sourced id.
  const idRemap = new Map(projects.map((p, i) => [p.id, resolvedIds[i]]));
  const remappedPhotos = photos.map((ph) => ({ ...ph, projectId: idRemap.get(ph.projectId) ?? ph.projectId }));

  const syncedIds = new Set(resolvedIds);
  const mergedPhotos = existingPh.filter((ph) => !syncedIds.has(ph.projectId)).concat(remappedPhotos);

  await fs.writeFile(path.join(DATA_DIR, "projects.json"), JSON.stringify([...pById.values()], null, 2));
  await fs.writeFile(path.join(DATA_DIR, "photos.json"), JSON.stringify(mergedPhotos, null, 2));
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
    async *listPhotosByTagIds() {
      // No real tag ids in fixture mode (resolveTagIds needs a live token) —
      // nothing to yield.
    },
    async getProject(id) {
      return samples.find((s) => s.id === id) ?? null;
    },
    async hasAtLeastPhotos(projectId, threshold) {
      return (photos[projectId]?.length ?? 0) >= threshold;
    },
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const token = process.env.COMPANYCAM_API_TOKEN;
  const target = process.env.DATA_SOURCE === "postgres" ? "postgres" : "fixtures";

  let photoTagIds: string[] = [];
  if (token && PHOTO_FILTER_MODE === "tags") {
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
  } else if (token) {
    console.log(`Photo filter: OFF — pulling every photo for every project (PHOTO_FILTER_MODE = "all").`);
  }
  const client = token
    ? createLiveClient(token, process.env.COMPANYCAM_API_BASE, photoTagIds)
    : fixtureClient();

  // FIXED (previously a real bug, confirmed against real data): CompanyCam's
  // /projects list endpoint has a hard max-offset cap (~10-20k rows deep,
  // sorted by most-recent-activity), and tagging a photo does NOT bump its
  // parent project's activity timestamp. Together, a project that hadn't had
  // OTHER CompanyCam activity in a while could get a photo tagged and still
  // never be reached by a scan of /projects, no matter how the incremental
  // cursor was set — a live run confirmed this exact failure (a newly-tagged
  // Montgomery, AL project never appeared even after a --full scan).
  //
  // FIX: in "tags" mode (the default — see PHOTO_FILTER_MODE above) we no
  // longer scan /projects at all. CompanyCam's GLOBAL /photos search endpoint
  // can filter by tag_ids directly (cursor-paginated, no offset cap, and
  // completely independent of any project's activity/sort order) — so we ask
  // it for every photo that carries one of PHOTO_TAG_NAMES, then fetch just
  // those specific projects by id (GET /projects/:id, a direct lookup with no
  // cap). This is also cheap enough to always run as a full sweep: there's no
  // more incremental-vs-full distinction to get wrong, since the only thing
  // ever scanned is the comparatively small set of currently-tagged photos.
  //
  // The old /projects-scan path (listProjectsUpdatedSince + per-project
  // listPhotos, including its own incremental/--full state-file logic) is
  // kept below under PHOTO_FILTER_MODE = "all" only — not used currently,
  // kept for reference in case the tagging convention changes again.
  const startedAt = new Date().toISOString();

  console.log(`CompanyCam sync`);
  console.log(`  source:  ${token ? "LIVE" : "FIXTURE (no token — set COMPANYCAM_API_TOKEN)"}`);
  console.log(`  target:  ${target}${target === "fixtures" ? " (data/*.json)" : " (Postgres)"}`);
  console.log(`  mode:    ${PHOTO_FILTER_MODE === "tags" ? "global tag search (not a project scan)" : "full project scan"}`);
  if (args.limit) console.log(`  limit:   ${args.limit} (smoke test)`);

  const projects: Project[] = [];
  const photos: ProjectPhoto[] = [];

  if (PHOTO_FILTER_MODE === "tags") {
    if (args.projectsOnly) {
      console.warn(
        `--projects-only has no effect in "tags" mode: inclusion on the map now depends on having a ` +
          `tagged photo, so there's no separate "projects" step to skip. Ignoring the flag.`,
      );
    }
    if (!photoTagIds.length) {
      console.warn(`Skipping entirely — no photo tags resolved (see warning above). No pins will be added.`);
    } else {
      // 1) Global photo search by tag id — every photo tagged with any of
      // PHOTO_TAG_NAMES, across every project, however old or inactive.
      const photosByProject = new Map<string, CompanyCamPhoto[]>();
      let totalTaggedPhotos = 0;
      for await (const photo of client.listPhotosByTagIds(photoTagIds)) {
        totalTaggedPhotos++;
        const pid = photo.project_id;
        if (!pid) continue;
        const list = photosByProject.get(pid) ?? [];
        list.push(photo);
        photosByProject.set(pid, list);
        if (args.limit && photosByProject.size >= args.limit) break;
      }
      console.log(
        `Found ${totalTaggedPhotos} tagged photo(s) across ${photosByProject.size} project(s) ` +
          `(global tag search — not subject to the /projects offset cap).`,
      );

      // 2) Fetch each of those specific projects directly by id (not the
      // capped list endpoint), and pair it with the tagged photos we already
      // have from step 1 — no need to re-fetch photos per project.
      let skipped = 0;
      let done = 0;
      const projectIds = [...photosByProject.keys()];
      await mapPool(projectIds, PHOTO_CONCURRENCY, async (pid) => {
        try {
          const raw = await client.getProject(pid);
          if (!raw) {
            skipped++;
            if (skipped <= 10) console.warn(`  skip ${pid}: project not found (404 — deleted or archived)`);
            return;
          }
          const { project, skippedReason } = transformProject(raw);
          if (!project) {
            skipped++;
            if (skipped <= 10) console.warn(`  skip ${pid}: ${skippedReason}`);
            return;
          }
          const transformed = transformPhotos(project.id, photosByProject.get(pid) ?? []);
          project.photoCount = transformed.length;
          projects.push(project);
          photos.push(...transformed);
        } catch (e) {
          skipped++;
          console.warn(`  project fetch failed for ${pid}: ${(e as Error).message}`);
        }
        if (++done % PROGRESS_EVERY === 0) console.log(`  …${done}/${projectIds.length} projects`);
      });
      console.log(`Skipped ${skipped} project(s) total (first 10 shown above, if any).`);
      console.log(`Photos: ${photos.length} total.`);
    }
  } else {
    // Legacy "all" mode: full /projects scan + per-project photo fetch.
    // Subject to the max-offset cap described above — kept for reference.
    const state = await readJson<{ lastSyncIso: string | null }>(STATE_FILE, { lastSyncIso: null });
    const sinceIso = args.full ? null : state.lastSyncIso;
    console.log(`  scan mode: ${sinceIso ? `incremental since ${sinceIso}` : "full backfill"}`);

    let scanned = 0;
    let skipped = 0;
    const candidates: Project[] = [];
    for await (const raw of client.listProjectsUpdatedSince(sinceIso)) {
      scanned++;
      const { project, skippedReason } = transformProject(raw);
      if (!project) {
        skipped++;
        if (skipped <= 10) console.warn(`  skip ${raw.id}: ${skippedReason}`);
        continue;
      }
      candidates.push(project);
      if (candidates.length % PROGRESS_EVERY === 0) console.log(`  …${candidates.length} candidates`);
      if (args.limit && candidates.length >= args.limit) break;
    }
    console.log(`Candidates: ${candidates.length} geocodable, ${skipped} skipped (of ${scanned} scanned).`);

    if (args.projectsOnly) {
      console.log(`Skipping photo fetch (--projects-only). photo_count still reflects CompanyCam's raw total.`);
      projects.push(...candidates);
    } else {
      const withPhotos = candidates.filter((p) => p.photoCount > 0);
      console.log(`Fetching photos for ${withPhotos.length} candidates (concurrency ${PHOTO_CONCURRENCY})…`);
      let done = 0;
      await mapPool(withPhotos, PHOTO_CONCURRENCY, async (p) => {
        try {
          const raw = await client.listPhotos(p.companycamProjectId);
          const transformed = transformPhotos(p.id, raw);
          p.photoCount = transformed.length;
          projects.push(p);
          photos.push(...transformed);
        } catch (e) {
          console.warn(`  photo fetch failed for ${p.id}: ${(e as Error).message}`);
        }
        if (++done % PROGRESS_EVERY === 0) console.log(`  …${done}/${withPhotos.length} photo sets`);
      });
      console.log(`Photos: ${photos.length} total.`);
    }

    if (!args.limit) {
      await fs.writeFile(STATE_FILE, JSON.stringify({ lastSyncIso: startedAt }, null, 2));
      console.log(`Sync state updated → ${startedAt}`);
    }
  }
  console.log(`Projects: ${projects.length} will get a pin.`);

  // 3) Enforce opt-outs.
  const suppressed = await applyOptOuts(projects);
  if (suppressed) console.log(`Opt-outs: suppressed ${suppressed} project(s).`);

  // 4) Write to the active store. writeFixtures always merges/upserts (see
  // its comment) — it never wholesale-replaces the historical PMI-sourced
  // projects that also live in this file.
  if (target === "postgres") {
    await writePostgres(projects, photos);
    console.log(`Upserted ${projects.length} projects + ${photos.length} photos into Postgres.`);
  } else {
    await writeFixtures(projects, photos);
    console.log(`Merged ${projects.length} synced projects (+ ${photos.length} photos) into data/*.json.`);
  }

  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
