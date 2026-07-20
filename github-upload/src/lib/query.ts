import { z } from "zod";
import type { ProjectQuery } from "@/lib/types";

// Parse the shared map/list filters from a request URL's search params.
export function parseProjectQuery(searchParams: URLSearchParams): ProjectQuery {
  const query: ProjectQuery = {};

  const bbox = searchParams.get("bbox");
  if (bbox) {
    const parts = bbox.split(",").map(Number);
    if (parts.length === 4 && parts.every((n) => Number.isFinite(n))) {
      query.bbox = [parts[0], parts[1], parts[2], parts[3]];
    }
  }

  const tags = searchParams.get("tags");
  if (tags) query.tags = tags.split(",").map((t) => t.trim()).filter(Boolean);

  const locations = searchParams.get("locations");
  if (locations) query.locationIds = locations.split(",").map((t) => t.trim()).filter(Boolean);

  const search = searchParams.get("search");
  if (search?.trim()) query.search = search.trim();

  const hasPhotos = searchParams.get("hasPhotos");
  if (hasPhotos === "1" || hasPhotos === "true") query.hasPhotos = true;

  return query;
}

export const leadSchema = z.object({
  projectId: z.string().nullable().default(null),
  name: z.string().min(1, "Name is required").max(200),
  phone: z.string().min(7, "A valid phone is required").max(40),
  email: z.string().email("A valid email is required").max(200),
  message: z.string().max(2000).default(""),
});

export const optOutSchema = z.object({
  addressOrProjectId: z.string().min(3, "Enter your address or project ID").max(400),
  method: z.enum(["form", "phone", "email"]).default("form"),
  contactEmail: z.string().email().max(200).nullable().default(null),
});
