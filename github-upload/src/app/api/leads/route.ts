import { NextRequest, NextResponse } from "next/server";
import { getRepo } from "@/lib/repo";
import { leadSchema } from "@/lib/query";

export const dynamic = "force-dynamic";

// Lead capture. In production this also enqueues a HubSpot sync (Open Q #3).
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = leadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.flatten().fieldErrors },
      { status: 422 },
    );
  }

  const repo = await getRepo();
  const lead = await repo.createLead(parsed.data);
  return NextResponse.json({ lead }, { status: 201 });
}
