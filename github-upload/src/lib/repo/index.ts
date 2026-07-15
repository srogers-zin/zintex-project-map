import type { Repo } from "@/lib/repo/repo";
import { FixtureRepo } from "@/lib/repo/fixtures";

let instance: Repo | null = null;

// Selects the data backend at runtime. Defaults to fixtures so the app runs
// with zero credentials. Set DATA_SOURCE=postgres (and DATABASE_URL) to switch.
export async function getRepo(): Promise<Repo> {
  if (instance) return instance;
  if (process.env.DATA_SOURCE === "postgres") {
    const { PostgresRepo } = await import("@/lib/repo/postgres");
    instance = new PostgresRepo();
  } else {
    instance = new FixtureRepo();
  }
  return instance;
}

export type { Repo };
