import { promises as fs } from "node:fs";
import path from "node:path";

// Load .env.local so COMPANYCAM_API_TOKEN is picked up here too (tsx doesn't
// auto-load env files the way the Next.js app does).
try {
  (process as unknown as { loadEnvFile: (p: string) => void }).loadEnvFile(
    path.join(process.cwd(), ".env.local"),
  );
} catch {
  /* no .env.local yet — fine */
}

import {
  createLiveClient,
  transformProject,
  type CompanyCamClient,
  type CompanyCamProject,
} from "../src/lib/companycam";
import type { Project } from "../src/lib/types";
import { matchesOptOut } from "../src/lib/opt-out-match";

// ===========================================================================
// Flags CompanyCam projects that are well-documented (15+ total photos) but
// have NOTHING tagged for the public map yet, so Sales Leadership can spot
// them and go tag a few — see src/lib/types.ts `Project.highVolumeUntagged`
// for how this is used (a distinct pin color; see MapView.tsx) and the
// project's "Open in CompanyCam" link in ProjectModal.tsx for how someone
// actually acts on it.
//
// Deliberately a SEPARATE script from the hourly scripts/sync-companycam.ts
// tag sync, and meant to run on its own slower cadence:
//
//   scripts/sync-companycam.ts (hourly) asks CompanyCam directly for tagged
//   photos via the global /photos?tag_ids[] search — cheap, no project scan,
//   no offset cap.
//
//   This script has no such shortcut. CompanyCam doesn't expose a photo
//   count anywhere on the Project object, so finding "which UNTAGGED
//   projects have 15+ photos" means (a) scanning /projects — which DOES have
//   a hard max-offset cap and is sorted by most-recent-activity, so some
//   older/inactive projects may never be reached — and (b) one extra photos
//   request per candidate project to check its count. That's materially
//   heavier, so it's meant to run daily (or less often), not hourly — see
//   .github/workflows/flag-companycam-volume.yml.
//
//   COMPANYCAM_API_TOKEN=xxx npm run flag:companycam-volume
//   COMPANYCAM_API_TOKEN=xxx npm run flag:companycam-volume -- --limit 50       # smoke test
//   COMPANYCAM_API_TOKEN=xxx npm run flag:companycam-volume -- --threshold 20  # override 15
// ===========================================================================

const THRESHOLD_DEFAULT = 15;
const CONCURRENCY = 6;
const PROGRESS_EVERY = 500;
const DATA_DIR = path.join(process.cwd(), "data");
const OPTOUTS_FILE = path.join(DATA_DIR, "opt-outs.json");

interface Args {
  limit: number | null;
  threshold: number;
}
function parseArgs(argv: string[]): Args {
  const limitIdx = argv.indexOf("--limit");
  const thresholdIdx = argv.indexOf("--threshold");
  return {
    limit: limitIdx >= 0 ? Number(argv[limitIdx + 1]) : null,
    threshold: thresholdIdx >= 0 ? Number(argv[thresholdIdx + 1]) : THRESHOLD_DEFAULT,
  };
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

// Run `fn` over items with a fixed concurrency ceiling.
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const token = process.env.COMPANYCAM_API_TOKEN;
  if (!token) {
    console.error("COMPANYCAM_API_TOKEN is required — this script only makes sense against live CompanyCam data.");
    process.exit(1);
  }
  const client: CompanyCamClient = createLiveClient(token, process.env.COMPANYCAM_API_BASE);

  console.log(`CompanyCam high-volume-untagged flag sync`);
  console.log(`  threshold: ${args.threshold}+ total photos`);
  if (args.limit) console.log(`  limit:     ${args.limit} candidate(s) (smoke test)`);

  const existing = await readJson<Project[]>(path.join(DATA_DIR, "projects.json"), []);
  // Projects already featured (1+ tagged photo already on the map) never
  // need this flag — skip them without even checking CompanyCam.
  const alreadyFeatured = new Set(
    existing.filter((p) => p.photoCount > 0 && p.companycamProjectId).map((p) => p.companycamProjectId),
  );

  // 1) Scan /projects (subject to the max-offset cap — see companycam.ts)
  // and collect candidates not already featured on the map.
  let scanned = 0;
  let skippedFeatured = 0;
  const candidates: CompanyCamProject[] = [];
  for await (const raw of client.listProjectsUpdatedSince(null)) {
    scanned++;
    if (alreadyFeatured.has(raw.id)) {
      skippedFeatured++;
      continue;
    }
    candidates.push(raw);
    if (candidates.length % PROGRESS_EVERY === 0) console.log(`  …${candidates.length} candidate(s) to check`);
    if (args.limit && candidates.length >= args.limit) break;
  }
  console.log(
    `Scanned ${scanned} project(s) (subject to CompanyCam's max-offset cap). ` +
      `${skippedFeatured} already featured (skipped), ${candidates.length} to check.`,
  );

  // 2) For each candidate, confirm it's geocodable/in-territory, then do the
  // one cheap "does it have >= threshold photos" check.
  let skippedNotGeocodable = 0;
  let checked = 0;
  let flagged = 0;
  let done = 0;
  const flaggedProjects: Project[] = [];
  await mapPool(candidates, CONCURRENCY, async (raw) => {
    const { project, skippedReason } = transformProject(raw);
    if (!project) {
      skippedNotGeocodable++;
      if (skippedNotGeocodable <= 10) console.warn(`  skip ${raw.id}: ${skippedReason}`);
      return;
    }
    checked++;
    try {
      const hasEnough = await client.hasAtLeastPhotos(raw.id, args.threshold);
      if (hasEnough) {
        flagged++;
        flaggedProjects.push({ ...project, photoCount: 0, highVolumeUntagged: true });
      }
    } catch (e) {
      console.warn(`  photo-count check failed for ${raw.id}: ${(e as Error).message}`);
    }
    if (++done % PROGRESS_EVERY === 0) console.log(`  …${done}/${candidates.length} checked`);
  });
  console.log(
    `Checked ${checked} geocodable candidate(s) (${skippedNotGeocodable} skipped — bad address/coords/service area). ` +
      `${flagged} have ${args.threshold}+ untagged photos.`,
  );

  // 3) Enforce opt-outs before writing.
  const optOuts = await readJson<Array<{ addressOrProjectId: string }>>(OPTOUTS_FILE, []);
  let suppressed = 0;
  for (const p of flaggedProjects) {
    if (optOuts.some((o) => matchesOptOut(p, o.addressOrProjectId))) {
      p.optedOut = true;
      suppressed++;
    }
  }
  if (suppressed) console.log(`Opt-outs: suppressed ${suppressed} flagged project(s).`);

  // 4) Non-destructive merge into data/projects.json — same rules as
  // sync-companycam.ts's writeFixtures: never delete, only upsert by id
  // (matching on companycamProjectId when a PMI-sourced record already
  // represents the same physical project), and always spread the EXISTING
  // record first so fields the incoming (CompanyCam-derived) object doesn't
  // set — like `customerName`, used for review matching — survive the merge.
  const pById = new Map(existing.map((p) => [p.id, p]));

  // Self-heal: earlier runs (before transformProject correctly rejected
  // CompanyCam's (0, 0) "no GPS fix" sentinel as missing coordinates — see
  // companycam.ts) could have written a highVolumeUntagged record sitting at
  // literal Null Island. A real address can never legitimately geocode
  // there, so any leftover bad record like that is safe to drop — if it's
  // still a genuine candidate, this same run will just re-add it correctly
  // (or leave it out if CompanyCam still can't geocode it).
  let removedBadCoords = 0;
  for (const [id, p] of pById) {
    if (p.highVolumeUntagged && p.lat === 0 && p.lng === 0) {
      pById.delete(id);
      removedBadCoords++;
    }
  }
  if (removedBadCoords) {
    console.log(`Cleaned up ${removedBadCoords} bad (0,0) highVolumeUntagged record(s) from a previous run.`);
  }

  const idByCompanyCamId = new Map(
    [...pById.values()].filter((p) => p.companycamProjectId).map((p) => [p.companycamProjectId, p.id]),
  );
  for (const incoming of flaggedProjects) {
    const targetId = idByCompanyCamId.get(incoming.companycamProjectId) ?? incoming.id;
    const existingRecord = pById.get(targetId);
    pById.set(targetId, { ...existingRecord, ...incoming, id: targetId });
    idByCompanyCamId.set(incoming.companycamProjectId, targetId);
  }
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(path.join(DATA_DIR, "projects.json"), JSON.stringify([...pById.values()], null, 2));
  console.log(`Merged ${flaggedProjects.length} flagged project(s) into data/projects.json.`);
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
