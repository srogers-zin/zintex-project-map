// Removes already-synced projects that fall outside Zintex's real service
// area (stray California/Colorado/Northeast/South Florida geocodes seen live
// on the map) without needing to re-run the full CompanyCam sync. Going
// forward, scripts/sync-companycam.ts skips these at the source (see
// isInServiceArea in src/lib/branches.ts) — this is a one-time cleanup for
// data already sitting in data/projects.json.
//
// Usage: npm run filter-service-area

import { promises as fs } from "node:fs";
import path from "node:path";
import type { Project, ProjectPhoto } from "../src/lib/types";
import { isInServiceArea } from "../src/lib/branches";

const DATA_DIR = path.join(process.cwd(), "data");
const PROJECTS_FILE = path.join(DATA_DIR, "projects.json");
const PHOTOS_FILE = path.join(DATA_DIR, "photos.json");

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

// The formatted address is "street, city, state[, zip]" (comma-joined, empty
// parts dropped). The last segment is the zip if it's all digits; otherwise
// the last segment IS the state. So the state is whichever of the last two
// segments isn't a zip code.
function parseStateFromAddress(address: string): string | null {
  const parts = address.split(",").map((s) => s.trim()).filter(Boolean);
  if (!parts.length) return null;
  const last = parts[parts.length - 1];
  const isZip = /^\d[\d-]*$/.test(last);
  const state = isZip ? parts[parts.length - 2] : last;
  return state ?? null;
}

async function main() {
  const projects = await readJson<Project[]>(PROJECTS_FILE, []);
  const photos = await readJson<ProjectPhoto[]>(PHOTOS_FILE, []);

  if (!projects.length) {
    console.error("No data/projects.json found — nothing to filter.");
    process.exit(1);
  }

  const keep: Project[] = [];
  const removed: Project[] = [];
  for (const p of projects) {
    const state = parseStateFromAddress(p.address);
    if (isInServiceArea(state, p.lat, p.lng)) {
      keep.push(p);
    } else {
      removed.push(p);
    }
  }

  if (removed.length) {
    console.log(`Removing ${removed.length} out-of-territory project(s):`);
    for (const p of removed) console.log(`  - ${p.address}`);
  }

  const removedIds = new Set(removed.map((p) => p.id));
  const keptPhotos = photos.filter((ph) => !removedIds.has(ph.projectId));

  await fs.writeFile(PROJECTS_FILE, JSON.stringify(keep, null, 2));
  await fs.writeFile(PHOTOS_FILE, JSON.stringify(keptPhotos, null, 2));

  console.log(
    `Done. Kept ${keep.length} of ${projects.length} projects. Photos: ${keptPhotos.length} (was ${photos.length}).`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
