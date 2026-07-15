import { NextRequest, NextResponse } from "next/server";
import { getRepo } from "@/lib/repo";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const repo = await getRepo();
  const detail = await repo.getProjectDetail(id);
  if (!detail) {
    // Either not found or opted-out — same response so suppression isn't probeable.
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
  return NextResponse.json({ project: detail });
}
