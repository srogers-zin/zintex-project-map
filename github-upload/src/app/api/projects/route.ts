import { NextRequest, NextResponse } from "next/server";
import { getRepo } from "@/lib/repo";
import { parseProjectQuery } from "@/lib/query";

export const dynamic = "force-dynamic";

// Paginated sidebar list. Mirrors the map filters.
export async function GET(req: NextRequest) {
  const repo = await getRepo();
  const sp = req.nextUrl.searchParams;
  const query = parseProjectQuery(sp);
  const limit = Math.min(Math.max(Number(sp.get("limit")) || 50, 1), 200);
  const offset = Math.max(Number(sp.get("offset")) || 0, 0);
  const { items, total } = await repo.listProjects(query, limit, offset);
  return NextResponse.json({ items, total, limit, offset });
}
