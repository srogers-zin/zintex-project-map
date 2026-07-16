import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type {
  Lead,
  LeadInput,
  Location,
  OptOutInput,
  Project,
  ProjectDetail,
  ProjectPhoto,
  ProjectPin,
  ProjectQuery,
  Review,
} from "@/lib/types";
import type { Repo } from "@/lib/repo/repo";
import { matchesOptOut } from "@/lib/opt-out-match";

// Fixture-backed repository. Reads seeded JSON produced by `npm run seed`.
// Writes (leads, opt-outs) go to gitignored runtime files under /data so the
// demo behaves end-to-end without a database.

const DATA_DIR = path.join(process.cwd(), "data");
const LEADS_FILE = path.join(DATA_DIR, "leads.log.json");
const OPTOUTS_FILE = path.join(DATA_DIR, "opt-outs.json");

interface Dataset {
  locations: Location[];
  projects: Project[];
  photos: ProjectPhoto[];
  reviews: Review[];
}

let cache: Dataset | null = null;

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(file, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function load(): Promise<Dataset> {
  if (cache) return cache;
  const [locations, projects, photos, reviews] = await Promise.all([
    readJson<Location[]>(path.join(DATA_DIR, "locations.json"), []),
    readJson<Project[]>(path.join(DATA_DIR, "projects.json"), []),
    readJson<ProjectPhoto[]>(path.join(DATA_DIR, "photos.json"), []),
    readJson<Review[]>(path.join(DATA_DIR, "reviews.json"), []),
  ]);
  if (locations.length === 0 || projects.length === 0) {
    // Don't cache a partial/empty read (e.g. a transient disk hiccup right
    // after a cold start) — caching it would permanently stick the app at
    // "0 projects" until the process restarts. Leave `cache` unset so the
    // next request retries the read from disk.
    console.error(
      `Fixture load returned locations=${locations.length}, projects=${projects.length} — not caching, will retry next request.`,
    );
    throw new Error(
      "No fixtures found (or read returned empty). Run `npm run seed` to generate demo data in /data.",
    );
  }
  cache = { locations, projects, photos, reviews };
  return cache;
}

function inBbox(p: { lat: number; lng: number }, bbox: ProjectQuery["bbox"]): boolean {
  if (!bbox) return true;
  const [west, south, east, north] = bbox;
  return p.lng >= west && p.lng <= east && p.lat >= south && p.lat <= north;
}

function matchesFilters(p: Project, query: ProjectQuery): boolean {
  if (p.optedOut) return false; // opt-out enforcement — never expose suppressed projects
  if (!inBbox(p, query.bbox)) return false;
  if (query.locationIds?.length && !query.locationIds.includes(p.locationId)) return false;
  if (query.tags?.length && !query.tags.some((t) => p.tags.includes(t))) return false;
  if (query.search) {
    const needle = query.search.trim().toLowerCase();
    if (needle && !p.address.toLowerCase().includes(needle)) return false;
  }
  return true;
}

export class FixtureRepo implements Repo {
  async getLocations(): Promise<Location[]> {
    const { locations } = await load();
    return locations;
  }

  async getPins(query: ProjectQuery): Promise<ProjectPin[]> {
    const { projects } = await load();
    return projects
      .filter((p) => matchesFilters(p, query))
      .map((p) => ({
        id: p.id,
        lat: p.lat,
        lng: p.lng,
        hasPhotos: p.photoCount > 0,
        tags: p.tags,
        locationId: p.locationId,
      }));
  }

  async listProjects(query: ProjectQuery, limit: number, offset: number) {
    const { projects } = await load();
    const filtered = projects.filter((p) => matchesFilters(p, query));
    return {
      items: filtered.slice(offset, offset + limit),
      total: filtered.length,
    };
  }

  async getProjectDetail(id: string): Promise<ProjectDetail | null> {
    const { projects, photos, reviews, locations } = await load();
    const project = projects.find((p) => p.id === id);
    if (!project || project.optedOut) return null; // opt-out enforcement
    const loc = locations.find((l) => l.id === project.locationId);
    // customerName is homeowner PII used only for server-side review
    // matching (see scripts/sync-birdeye-reviews.ts) — strip it before
    // shipping the project to the client.
    const { customerName: _customerName, ...publicProject } = project;
    return {
      ...publicProject,
      locationName: loc?.name ?? "Unknown",
      photos: photos
        .filter((ph) => ph.projectId === id)
        .sort((a, b) => a.sortOrder - b.sortOrder),
      reviews: reviews
        .filter((r) => r.projectId === id)
        .sort((a, b) => (a.postedAt < b.postedAt ? 1 : -1)),
    };
  }

  async getReviews(locationIds?: string[]): Promise<Review[]> {
    const { reviews } = await load();
    const filtered = locationIds?.length
      ? reviews.filter((r) => locationIds.includes(r.locationId))
      : reviews;
    return [...filtered].sort((a, b) => (a.postedAt < b.postedAt ? 1 : -1));
  }

  async createLead(input: LeadInput): Promise<Lead> {
    const lead: Lead = {
      id: randomUUID(),
      ...input,
      submittedAt: new Date().toISOString(),
      crmSyncStatus: "pending",
    };
    const existing = await readJson<Lead[]>(LEADS_FILE, []);
    existing.push(lead);
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(LEADS_FILE, JSON.stringify(existing, null, 2));
    return lead;
  }

  async createOptOut(input: OptOutInput): Promise<{ id: string; suppressedCount: number }> {
    const id = randomUUID();
    const existing = await readJson<Array<OptOutInput & { id: string; requestedAt: string }>>(
      OPTOUTS_FILE,
      [],
    );
    existing.push({ id, ...input, requestedAt: new Date().toISOString() });
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(OPTOUTS_FILE, JSON.stringify(existing, null, 2));

    // Enforce immediately against the in-memory dataset so the demo reflects
    // the suppression without a re-seed. In production this is a DB UPDATE.
    // See src/lib/opt-out-match.ts for the matching rule — deliberately exact
    // (not "contains") to prevent one vague entry from suppressing far more
    // than the single property it was meant for.
    const data = await load();
    let suppressedCount = 0;
    for (const p of data.projects) {
      if (matchesOptOut(p, input.addressOrProjectId) && !p.optedOut) {
        p.optedOut = true;
        suppressedCount++;
      }
    }
    return { id, suppressedCount };
  }
}
