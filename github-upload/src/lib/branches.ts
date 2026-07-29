import type { Location } from "@/lib/types";

// The 8 Zintex branch locations confirmed in the PMI audit. Coordinates are
// approximate city centers — replace with exact office coordinates + real
// Google Place IDs when Google Business Profile access is granted (Open Q #2).
export const BRANCHES: Location[] = [
  { id: "abilene", name: "Abilene", address: "Abilene, TX", phone: "(325) 000-0000", lat: 32.4487, lng: -99.7331, googlePlaceId: null },
  { id: "amarillo", name: "Amarillo", address: "Amarillo, TX", phone: "(806) 000-0000", lat: 35.222, lng: -101.8313, googlePlaceId: null },
  { id: "dfw", name: "Dallas–Fort Worth", address: "Dallas–Fort Worth, TX", phone: "(214) 000-0000", lat: 32.7555, lng: -97.3308, googlePlaceId: null },
  { id: "lubbock", name: "Lubbock", address: "Lubbock, TX", phone: "(806) 000-0000", lat: 33.5779, lng: -101.8552, googlePlaceId: null },
  { id: "midland-odessa", name: "Midland/Odessa", address: "Midland, TX", phone: "(432) 000-0000", lat: 31.9974, lng: -102.0779, googlePlaceId: null },
  { id: "san-angelo", name: "San Angelo", address: "San Angelo, TX", phone: "(325) 000-0000", lat: 31.4638, lng: -100.437, googlePlaceId: null },
  { id: "wichita-falls", name: "Wichita Falls", address: "Wichita Falls, TX", phone: "(940) 000-0000", lat: 33.9137, lng: -98.4934, googlePlaceId: null },
  { id: "tyler", name: "East Texas/Tyler", address: "Tyler, TX", phone: "(903) 000-0000", lat: 32.3513, lng: -95.3011, googlePlaceId: null },
];

// Service categories mirroring CompanyCam project labels/tags seen in the audit
// (Baths, Windows) plus the typical Zintex remodeling catalog.
export const SERVICE_TAGS = [
  "Baths",
  "Windows",
  "Roofing",
  "Siding",
  "Doors",
  "Kitchens",
  "Gutters",
] as const;

export type ServiceTag = (typeof SERVICE_TAGS)[number];

// States Zintex actually operates in, confirmed against the real cluster
// footprint live on the map (first pass flagged Iowa/Illinois/Alabama/Georgia
// as bad data — they aren't, they're real territory; corrected below).
// CompanyCam addresses come through inconsistently formatted — sometimes the
// 2-letter abbreviation ("TX"), sometimes the full name ("Kansas") — so this
// covers both forms per state. Anything not in this list (stray California,
// Colorado, or Northeast geocodes seen on the map) is almost certainly a
// bad/mistaken address, not a real out-of-territory customer.
// Edit this list directly if a legitimate new state needs to be added.
const SERVICE_STATE_TOKENS = new Set(
  [
    ["TX", "Texas"],
    ["OK", "Oklahoma"],
    ["AR", "Arkansas"],
    ["LA", "Louisiana"],
    ["MS", "Mississippi"],
    ["TN", "Tennessee"],
    ["KS", "Kansas"],
    ["MO", "Missouri"],
    ["IA", "Iowa"],
    ["IL", "Illinois"],
    ["AL", "Alabama"],
    ["GA", "Georgia"],
  ].flat().map((s) => s.toLowerCase()),
);

const FLORIDA_TOKENS = new Set(["fl", "florida"]);
// Zintex covers the FL panhandle, including Tallahassee, not the peninsula/
// southern FL. CORRECTED: the previous cutoff of -84.5 was actually ~15mi
// WEST of downtown Tallahassee (~-84.28), so it was silently excluding real
// Tallahassee jobs as "outside service area" — confirmed after Tallahassee-
// tagged CompanyCam photos never appeared on the map despite a clean sync.
// -83.9 keeps all of the Tallahassee metro while still excluding Live Oak
// (~-82.99) and Lake City (~-82.64) further east.
const FLORIDA_PANHANDLE_MAX_LNG = -83.9;

const KENTUCKY_TOKENS = new Set(["ky", "kentucky"]);
// Zintex covers southern KY only. Confirmed against every real PMI project
// tagged Kentucky (scripts/pmi-find-state.ts): the whole existing footprint
// (Tompkinsville, Franklin, Burkesville, Cadiz, Hickman, etc.) sits between
// 36.57°N and 37.11°N, hugging the Tennessee border. 37.5 gives a bit of
// buffer above that cluster while still excluding Louisville (~38.25°N) and
// Lexington (~38.04°N).
const KENTUCKY_MAX_LAT = 37.5;

// True if a raw CompanyCam/PMI address looks like it's within Zintex's actual
// service territory. Missing/unrecognized state -> false (excluded); callers
// should treat that the same as any other "bad data" skip reason. Florida and
// Kentucky are special-cased to a sub-region using the project's coordinates.
export function isInServiceArea(
  state: string | undefined | null,
  lat?: number,
  lng?: number,
): boolean {
  if (!state) return false;
  const s = state.trim().toLowerCase();
  if (FLORIDA_TOKENS.has(s)) {
    return typeof lng === "number" && lng <= FLORIDA_PANHANDLE_MAX_LNG;
  }
  if (KENTUCKY_TOKENS.has(s)) {
    return typeof lat === "number" && lat <= KENTUCKY_MAX_LAT;
  }
  return SERVICE_STATE_TOKENS.has(s);
}

// Great-circle-ish nearest branch by squared degrees (adequate at this scale).
export function nearestBranchId(lat: number, lng: number): string {
  let best = BRANCHES[0];
  let bestD = Infinity;
  for (const b of BRANCHES) {
    const dLat = b.lat - lat;
    const dLng = (b.lng - lng) * Math.cos((lat * Math.PI) / 180);
    const d = dLat * dLat + dLng * dLng;
    if (d < bestD) {
      bestD = d;
      best = b;
    }
  }
  return best.id;
}
