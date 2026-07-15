import { promises as fs } from "node:fs";
import path from "node:path";
import { BRANCHES, SERVICE_TAGS, nearestBranchId } from "../src/lib/branches";
import type { Project, ProjectPhoto, Review } from "../src/lib/types";

// Deterministic demo-data generator. Produces JSON fixtures matching the
// Postgres schema so the app runs with zero credentials. Reproducible via a
// seeded PRNG so re-runs don't churn the dataset.
//
//   npm run seed
//
// Projects are scattered across the full multi-state service territory
// (TX, OK, AR, LA, MS, TN, KS) — the 8 branch OFFICES are all in Texas, but
// crews work across neighboring states, so each project maps to its nearest
// branch. Real data comes from scripts/sync-companycam.ts once API access lands.

const REVIEWS_PER_BRANCH = 24;
const OPT_OUT_RATE = 0.03; // a few pre-suppressed projects to exercise enforcement

// Market anchor cities across the 7-state territory. `count` roughly reflects
// relative project density (TX metros denser than far-territory markets).
interface Anchor {
  city: string;
  state: string;
  lat: number;
  lng: number;
  count: number;
}
const ANCHORS: Anchor[] = [
  // --- Texas (branch markets + metros) ---
  { city: "Abilene", state: "TX", lat: 32.4487, lng: -99.7331, count: 45 },
  { city: "Amarillo", state: "TX", lat: 35.222, lng: -101.8313, count: 40 },
  { city: "Fort Worth", state: "TX", lat: 32.7555, lng: -97.3308, count: 55 },
  { city: "Dallas", state: "TX", lat: 32.7767, lng: -96.797, count: 55 },
  { city: "Lubbock", state: "TX", lat: 33.5779, lng: -101.8552, count: 40 },
  { city: "Midland", state: "TX", lat: 31.9974, lng: -102.0779, count: 30 },
  { city: "Odessa", state: "TX", lat: 31.8457, lng: -102.3676, count: 24 },
  { city: "San Angelo", state: "TX", lat: 31.4638, lng: -100.437, count: 28 },
  { city: "Wichita Falls", state: "TX", lat: 33.9137, lng: -98.4934, count: 30 },
  { city: "Tyler", state: "TX", lat: 32.3513, lng: -95.3011, count: 34 },
  { city: "Waco", state: "TX", lat: 31.5493, lng: -97.1467, count: 22 },
  { city: "Austin", state: "TX", lat: 30.2672, lng: -97.7431, count: 26 },
  { city: "Houston", state: "TX", lat: 29.7604, lng: -95.3698, count: 30 },
  { city: "San Antonio", state: "TX", lat: 29.4241, lng: -98.4936, count: 24 },
  // --- Oklahoma ---
  { city: "Oklahoma City", state: "OK", lat: 35.4676, lng: -97.5164, count: 30 },
  { city: "Tulsa", state: "OK", lat: 36.15, lng: -95.9928, count: 26 },
  { city: "Lawton", state: "OK", lat: 34.6087, lng: -98.3903, count: 16 },
  // --- Arkansas ---
  { city: "Little Rock", state: "AR", lat: 34.7465, lng: -92.2896, count: 24 },
  { city: "Fort Smith", state: "AR", lat: 35.3859, lng: -94.3985, count: 16 },
  { city: "Fayetteville", state: "AR", lat: 36.0626, lng: -94.1574, count: 16 },
  { city: "Texarkana", state: "AR", lat: 33.4418, lng: -94.0377, count: 14 },
  // --- Louisiana ---
  { city: "Shreveport", state: "LA", lat: 32.5252, lng: -93.7502, count: 24 },
  { city: "Monroe", state: "LA", lat: 32.5093, lng: -92.1193, count: 14 },
  { city: "Baton Rouge", state: "LA", lat: 30.4515, lng: -91.1871, count: 20 },
  { city: "Lafayette", state: "LA", lat: 30.2241, lng: -92.0198, count: 14 },
  { city: "New Orleans", state: "LA", lat: 29.9511, lng: -90.0715, count: 22 },
  // --- Mississippi ---
  { city: "Jackson", state: "MS", lat: 32.2988, lng: -90.1848, count: 20 },
  { city: "Hattiesburg", state: "MS", lat: 31.3271, lng: -89.2903, count: 12 },
  { city: "Tupelo", state: "MS", lat: 34.2576, lng: -88.7034, count: 12 },
  { city: "Gulfport", state: "MS", lat: 30.3674, lng: -89.0928, count: 14 },
  // --- Tennessee ---
  { city: "Memphis", state: "TN", lat: 35.1495, lng: -90.049, count: 24 },
  { city: "Nashville", state: "TN", lat: 36.1627, lng: -86.7816, count: 22 },
  { city: "Knoxville", state: "TN", lat: 35.9606, lng: -83.9207, count: 16 },
  { city: "Chattanooga", state: "TN", lat: 35.0456, lng: -85.3097, count: 14 },
  // --- Kansas ---
  { city: "Wichita", state: "KS", lat: 37.6872, lng: -97.3301, count: 24 },
  { city: "Topeka", state: "KS", lat: 39.0473, lng: -95.6752, count: 14 },
  { city: "Kansas City", state: "KS", lat: 39.1155, lng: -94.6268, count: 16 },
  { city: "Salina", state: "KS", lat: 38.8403, lng: -97.6114, count: 12 },
];

// mulberry32 seeded PRNG — stable output across runs/machines.
function makeRng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rng = makeRng(20260713);
const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rng() * arr.length)];
const between = (lo: number, hi: number) => lo + rng() * (hi - lo);

const STREETS = [
  "Oak", "Maple", "Cedar", "Pine", "Elm", "Sunset", "Ridge", "Lakeview",
  "Prairie", "Mesquite", "Canyon", "Willow", "Birch", "Hillcrest", "Meadow",
];
const STREET_TYPE = ["St", "Ave", "Dr", "Ln", "Rd", "Ct", "Blvd"];

const REVIEW_SNIPPETS = [
  "Crew was professional and cleaned up every day. Highly recommend.",
  "Our new bathroom looks incredible. On time and on budget.",
  "Windows made a huge difference in our energy bill. Great team.",
  "From the quote to the install, everything was smooth.",
  "They walked us through every step. Couldn't be happier.",
  "Quality workmanship and fair pricing. Would use again.",
  "Roof replacement done in two days. Zero complaints.",
  "Responsive, honest, and the results speak for themselves.",
];
const FIRST_NAMES = ["Sarah", "Mike", "Jennifer", "David", "Ashley", "Robert", "Linda", "James", "Maria", "John", "Karen", "Chris"];
const LAST_INITIAL = ["B.", "R.", "T.", "M.", "H.", "S.", "W.", "G.", "C.", "P."];

function isoDaysAgo(days: number): string {
  // Fixed reference date (project "today") so output is deterministic.
  const ref = Date.UTC(2026, 6, 13); // 2026-07-13
  return new Date(ref - days * 86400000).toISOString();
}

function generate() {
  const projects: Project[] = [];
  const photos: ProjectPhoto[] = [];
  const reviews: Review[] = [];

  let pIdx = 0;
  for (const anchor of ANCHORS) {
    for (let i = 0; i < anchor.count; i++) {
      pIdx++;
      const id = `demo-${anchor.state.toLowerCase()}-${anchor.city.replace(/\s+/g, "-").toLowerCase()}-${i}`;
      // Scatter within ~0.25deg of the anchor city (metro-area spread).
      const lat = anchor.lat + between(-0.25, 0.25);
      const lng = anchor.lng + between(-0.3, 0.3);

      const tagCount = 1 + Math.floor(rng() * 2); // 1-2 services
      const tags = Array.from(new Set(Array.from({ length: tagCount }, () => pick(SERVICE_TAGS))));

      const hasPhotos = rng() > 0.15;
      const photoCount = hasPhotos ? 1 + Math.floor(rng() * 4) : 0;
      for (let j = 0; j < photoCount; j++) {
        // picsum.photos = credential-free placeholder imagery (allowlisted in next.config).
        photos.push({
          id: `${id}-photo-${j}`,
          projectId: id,
          url: `https://picsum.photos/seed/${id}-${j}/900/675`,
          sortOrder: j,
        });
      }

      const houseNo = 100 + Math.floor(rng() * 8900);
      const address = `${houseNo} ${pick(STREETS)} ${pick(STREET_TYPE)}, ${anchor.city}, ${anchor.state}`;

      projects.push({
        id,
        companycamProjectId: `cc-${pIdx}`,
        address,
        lat,
        lng,
        locationId: nearestBranchId(lat, lng), // nearest of the 8 TX branch offices
        tags,
        photoCount,
        createdAt: isoDaysAgo(Math.floor(between(1, 720))),
        optedOut: rng() < OPT_OUT_RATE,
      });
    }
  }

  // Reviews are per branch OFFICE (Google Business Profile is per location).
  for (const branch of BRANCHES) {
    for (let r = 0; r < REVIEWS_PER_BRANCH; r++) {
      const rating = rng() < 0.82 ? 5 : rng() < 0.6 ? 4 : 3;
      reviews.push({
        id: `rev-${branch.id}-${r}`,
        locationId: branch.id,
        googleReviewId: `g-${branch.id}-${r}`,
        rating,
        authorName: `${pick(FIRST_NAMES)} ${pick(LAST_INITIAL)}`,
        authorPhotoUrl: null,
        text: pick(REVIEW_SNIPPETS),
        postedAt: isoDaysAgo(Math.floor(between(1, 900))),
      });
    }
  }

  return { projects, photos, reviews };
}

async function main() {
  const dataDir = path.join(process.cwd(), "data");
  await fs.mkdir(dataDir, { recursive: true });
  const { projects, photos, reviews } = generate();

  await fs.writeFile(path.join(dataDir, "locations.json"), JSON.stringify(BRANCHES, null, 2));
  await fs.writeFile(path.join(dataDir, "projects.json"), JSON.stringify(projects, null, 2));
  await fs.writeFile(path.join(dataDir, "photos.json"), JSON.stringify(photos, null, 2));
  await fs.writeFile(path.join(dataDir, "reviews.json"), JSON.stringify(reviews, null, 2));

  const optedOut = projects.filter((p) => p.optedOut).length;
  const byState = new Map<string, number>();
  for (const p of projects) {
    const st = p.address.slice(-2);
    byState.set(st, (byState.get(st) ?? 0) + 1);
  }
  const stateBreakdown = [...byState.entries()].map(([s, n]) => `${s}:${n}`).join("  ");
  console.log(
    `Seeded fixtures:\n` +
      `  locations: ${BRANCHES.length}\n` +
      `  projects:  ${projects.length} (${optedOut} pre-opted-out)\n` +
      `  photos:    ${photos.length}\n` +
      `  reviews:   ${reviews.length}\n` +
      `  by state:  ${stateBreakdown}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
