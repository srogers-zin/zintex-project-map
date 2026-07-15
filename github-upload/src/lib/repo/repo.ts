import type {
  Lead,
  LeadInput,
  Location,
  OptOutInput,
  Project,
  ProjectDetail,
  ProjectPin,
  ProjectQuery,
  Review,
} from "@/lib/types";

// The single contract the API layer depends on. Two implementations exist:
//   - FixtureRepo  (demo, no DB)          -> src/lib/repo/fixtures.ts
//   - PostgresRepo (production, PostGIS)  -> src/lib/repo/postgres.ts
// Selected at runtime by DATA_SOURCE in src/lib/repo/index.ts.
export interface Repo {
  getLocations(): Promise<Location[]>;

  // Map pins (opt-out enforced). Filtered by bbox / tags / locations / search.
  getPins(query: ProjectQuery): Promise<ProjectPin[]>;

  // Sidebar list rows (opt-out enforced). Same filters as pins.
  listProjects(query: ProjectQuery, limit: number, offset: number): Promise<{ items: Project[]; total: number }>;

  // Full detail for the modal (opt-out enforced — returns null if suppressed).
  getProjectDetail(id: string): Promise<ProjectDetail | null>;

  getReviews(locationIds?: string[]): Promise<Review[]>;

  createLead(input: LeadInput): Promise<Lead>;

  createOptOut(input: OptOutInput): Promise<{ id: string; suppressedCount: number }>;
}
