// Quick diagnostic: which CompanyCam company + user does COMPANYCAM_API_TOKEN
// actually belong to? Run this whenever the project count from a sync looks
// wrong — it tells you definitively whether the token is scoped to the right
// company account, rather than guessing from the CompanyCam web UI (which
// doesn't show a project total anywhere obvious).
//
// Usage: npm run whoami

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

async function get(path: string) {
  const res = await fetch(BASE + path, {
    headers: { Authorization: `Bearer ${TOKEN}`, Accept: "application/json" },
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

async function main() {
  if (!TOKEN) {
    console.error("COMPANYCAM_API_TOKEN not set in .env.local — nothing to check.");
    process.exit(1);
  }

  const [user, company] = await Promise.all([get("/users/current"), get("/company")]);

  console.log("=== CompanyCam token identity ===");
  if (user.status === 200) {
    console.log(`User:    ${user.body.first_name} ${user.body.last_name} <${user.body.email_address}>`);
    console.log(`User ID: ${user.body.id}   Company ID: ${user.body.company_id}`);
  } else {
    console.log(`Could not fetch user (HTTP ${user.status}):`, user.body);
  }

  if (company.status === 200) {
    console.log(`Company: ${company.body.name}  (id ${company.body.id}, status ${company.body.status})`);
  } else {
    console.log(`Could not fetch company (HTTP ${company.status}):`, company.body);
  }

  console.log("");
  console.log("If \"Company\" above isn't \"Zintex Remodeling Group\" (or whatever your");
  console.log("real CompanyCam company is called), this token is scoped to the wrong");
  console.log("account — generate a new one while logged into the correct company.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
