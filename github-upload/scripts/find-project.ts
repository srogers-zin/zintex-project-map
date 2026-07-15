// One-off diagnostic: search CompanyCam directly for a project we know exists
// on the live Project Map It site, to check whether the gap between "50 via
// /projects" and "23,165 on Project Map It" is a default-listing filter
// (e.g. archived projects excluded) vs. a deeper data/account problem.
//
// Usage: npm run find-project -- "Robinson Road"

import path from "node:path";

try {
  (process as unknown as { loadEnvFile: (p: string) => void }).loadEnvFile(
    path.join(process.cwd(), ".env.local"),
  );
} catch {
  /* no .env.local yet — fine */
}

const BASE = process.env.COMPANYCAM_API_BASE || "https://api.companycam.com/v2";
const TOKEN = process.env.COMPANYCAM_API_TOKEN;

async function main() {
  const term = process.argv[2] || "Robinson Road";
  if (!TOKEN) {
    console.error("COMPANYCAM_API_TOKEN not set in .env.local.");
    process.exit(1);
  }

  const url = new URL(`${BASE}/projects`);
  url.searchParams.set("query", term);
  url.searchParams.set("per_page", "10");

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${TOKEN}`, Accept: "application/json" },
  });
  const body = await res.json().catch(() => null);

  console.log(`Search query: "${term}"  ->  HTTP ${res.status}`);
  if (Array.isArray(body)) {
    console.log(`${body.length} result(s):`);
    for (const p of body) {
      console.log(
        `  - ${p.name ?? "(no name)"} | ${[p.address?.street_address_1, p.address?.city, p.address?.state].filter(Boolean).join(", ")} | status=${p.status} archived=${p.archived}`,
      );
    }
  } else {
    console.log(body);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
