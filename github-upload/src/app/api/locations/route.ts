import { NextResponse } from "next/server";
import { getRepo } from "@/lib/repo";

export const dynamic = "force-dynamic";

export async function GET() {
  const repo = await getRepo();
  const locations = await repo.getLocations();
  return NextResponse.json({ locations });
}
