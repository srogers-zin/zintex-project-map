import { NextRequest, NextResponse } from "next/server";
import { getRepo } from "@/lib/repo";
import { parseProjectQuery } from "@/lib/query";

export const dynamic = "force-dynamic";

// Returns lightweight pins for the map. Clustering happens client-side
// (Supercluster). Opt-out enforcement is applied in the repo layer.
export async function GET(req: NextRequest) {
  const repo = await getRepo();
  const query = parseProjectQuery(req.nextUrl.searchParams);
  const pins = await repo.getPins(query);
  return NextResponse.json({ pins, count: pins.length });
}
