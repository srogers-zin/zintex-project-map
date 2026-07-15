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
}

// A project plus its photos — returned by the detail endpoint.
export interface ProjectDetail extends Project {
  photos: ProjectPhoto[];
  locationName: string;
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
}
