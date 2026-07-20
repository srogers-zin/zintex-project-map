// Shared domain types. These mirror the Postgres schema in db/schema.sql and are
// the contract between the data layer, API routes, and the UI.

export interface Location {
  id: string;
  name: string;
  address: string;
  phone: string;
  lat: number;
  lng: number;
  googlePlaceId: string | null;
}

export interface ProjectPhoto {
  id: string;
  projectId: string;
  url: string;
  sortOrder: number;
}

export interface Project {
  id: string;
  companycamProjectId: string;
  address: string;
  lat: number;
  lng: number;
  locationId: string; // nearest branch
  tags: string[]; // service types, mirror CompanyCam project tags
  photoCount: number;
  createdAt: string; // ISO
  optedOut: boolean;
  // Homeowner name, from PMI's project `name` / `surveyNames` fields. Used
  // only server-side to fuzzy-match Google/Birdeye reviews to a project —
  // never sent to the client (see ProjectDetail, which omits it).
  customerName?: string | null;
}

// A project plus its photos — returned by the detail endpoint. Deliberately
// omits `customerName` (homeowner privacy — it's only used server-side for
// review matching, never shipped to the browser).
export interface ProjectDetail extends Omit<Project, "customerName"> {
  photos: ProjectPhoto[];
  locationName: string;
  reviews: Review[];
}

// Lightweight pin used to render the map. We never ship the full project list
// with photos to the client; the map only needs coordinates + minimal metadata.
export interface ProjectPin {
  id: string;
  lat: number;
  lng: number;
  hasPhotos: boolean;
  tags: string[];
  locationId: string;
}

export interface Review {
  id: string;
  locationId: string;
  googleReviewId: string;
  rating: number; // 1-5
  authorName: string;
  authorPhotoUrl: string | null;
  text: string;
  postedAt: string; // ISO
  // Set when scripts/sync-birdeye-reviews.ts fuzzy-matches the reviewer's
  // name to a homeowner on a project in the same branch. Null/absent when no
  // confident match was found — the review still displays branch-wide.
  projectId?: string | null;
}

export interface LeadInput {
  projectId: string | null;
  name: string;
  phone: string;
  email: string;
  message: string;
}

export interface Lead extends LeadInput {
  id: string;
  submittedAt: string;
  crmSyncStatus: "pending" | "synced" | "failed";
}

export interface OptOutInput {
  // Homeowner supplies either their address or a project id (from a share link).
  addressOrProjectId: string;
  method: "form" | "phone" | "email";
  contactEmail: string | null;
}

// Query filters for the map/sidebar list.
export interface ProjectQuery {
  // Bounding box: [west, south, east, north]. Optional — omit for "all".
  bbox?: [number, number, number, number];
  tags?: string[];
  locationIds?: string[];
  search?: string; // free-text address/city match
  hasPhotos?: boolean; // "Photos only" toggle — restrict to photoCount > 0
}
