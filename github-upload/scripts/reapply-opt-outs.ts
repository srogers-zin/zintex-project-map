// Recomputes every project's `optedOut` flag from scratch against the
// current data/opt-outs.json, without re-fetching anything from CompanyCam.
// Useful whenever the opt-out list changes (entries added, removed, or the
// matching rule itself changes) and you don't want to wait through a full
// re-sync just to pick it up.
//
// Usage: npm run reapply-opt-outs

import { promises as fs } from "node:fs";
import path from "node:path";
import type { Project } from "../src/lib/types";
import { matchesOptOut } from "../src/lib/opt-out-match";

const DATA_DIR = path.join(process.cwd(), "data");
const PROJECTS_FILE = path.join(DATA_DIR, "projects.json");
const OPTOUTS_FILE = path.join(DATA_DIR, "opt-outs.json");

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

async function main() {
  const projects = await readJson<Project[]>(PROJECTS_FILE, []);
  const optOuts = await readJson<Array<{ addressOrProjectId: string }>>(OPTOUTS_FILE, []);

  if (!projects.length) {
    console.error("No data/projects.json found — nothing to recompute.");
    process.exit(1);
  }

  let suppressed = 0;
  for (const p of projects) {
    const hit = optOuts.some((o) => matchesOptOut(p, o.addressOrProjectId));
    if (p.optedOut !== hit) {
      console.log(`  ${hit ? "suppressing" : "un-suppressing"}: ${p.address}`);
    }
    p.optedOut = hit;
    if (hit) suppressed++;
  }

  await fs.writeFile(PROJECTS_FILE, JSON.stringify(projects, null, 2));
  console.log(`Done. ${suppressed} of ${projects.length} projects opted out (${optOuts.length} opt-out entries on file).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
