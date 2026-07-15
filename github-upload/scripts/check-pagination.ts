// Diagnostic: does GET /projects actually stop after page 1, or does our sync
// script's "batch.length < per_page means last page" assumption break because
// CompanyCam caps the FIRST page's size below what was requested? Fetch pages
// 1-3 explicitly and report what each one contains.
//
// Usage: npm run check-pagination

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

async function fetchPage(page: number, perPage: number) {
  const url = new URL(`${BASE}/projects`);
  url.searchParams.set("page", String(page));
  url.searchParams.set("per_page", String(perPage));
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${TOKEN}`, Accept: "application/json" },
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

async function main() {
  if (!TOKEN) {
    console.error("COMPANYCAM_API_TOKEN not set in .env.local.");
    process.exit(1);
  }

  for (const page of [1, 2, 3]) {
    const { status, body } = await fetchPage(page, 100);
    if (!Array.isArray(body)) {
      console.log(`page ${page}: HTTP ${status} ->`, body);
      continue;
    }
    const ids = body.map((p: { id: string }) => p.id);
    console.log(`page ${page}: HTTP ${status}, ${body.length} project(s)`);
    if (body.length) {
      console.log(`  first: ${ids[0]}   last: ${ids[ids.length - 1]}`);
    }
  }

  console.log("");
  console.log("Also trying per_page=25 (in case 50 is itself a hidden cap tied to per_page=100):");
  for (const page of [1, 2, 3]) {
    const { status, body } = await fetchPage(page, 25);
    const len = Array.isArray(body) ? body.length : -1;
    console.log(`  per_page=25 page ${page}: HTTP ${status}, ${len} project(s)`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
