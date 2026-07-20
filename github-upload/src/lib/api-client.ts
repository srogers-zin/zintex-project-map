import type { Filters } from "@/lib/filters";
import type { Location, Project, ProjectDetail, ProjectPin, Review } from "@/lib/types";

// Browser-side fetchers. Thin wrappers over the API routes.

function toParams(filters: Filters): string {
  const p = new URLSearchParams();
  if (filters.tags.length) p.set("tags", filters.tags.join(","));
  if (filters.locationIds.length) p.set("locations", filters.locationIds.join(","));
  if (filters.search.trim()) p.set("search", filters.search.trim());
  if (filters.hasPhotos) p.set("hasPhotos", "1");
  return p.toString();
}

export async function fetchLocations(): Promise<Location[]> {
  const res = await fetch("/api/locations");
  const data = await res.json();
  return data.locations as Location[];
}

export async function fetchPins(filters: Filters): Promise<ProjectPin[]> {
  const res = await fetch(`/api/pins?${toParams(filters)}`);
  const data = await res.json();
  return data.pins as ProjectPin[];
}

export async function fetchProjects(
  filters: Filters,
  limit: number,
  offset: number,
): Promise<{ items: Project[]; total: number }> {
  const p = new URLSearchParams(toParams(filters));
  p.set("limit", String(limit));
  p.set("offset", String(offset));
  const res = await fetch(`/api/projects?${p.toString()}`);
  const data = await res.json();
  return { items: data.items as Project[], total: data.total as number };
}

export async function fetchProjectDetail(id: string): Promise<ProjectDetail | null> {
  const res = await fetch(`/api/projects/${id}`);
  if (!res.ok) return null;
  const data = await res.json();
  return data.project as ProjectDetail;
}

export async function fetchReviews(
  locationIds: string[],
): Promise<{ reviews: Review[]; count: number; averageRating: number }> {
  const p = new URLSearchParams();
  if (locationIds.length) p.set("locations", locationIds.join(","));
  const res = await fetch(`/api/reviews?${p.toString()}`);
  return res.json();
}
