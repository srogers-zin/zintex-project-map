import { NextRequest, NextResponse } from "next/server";
import { getRepo } from "@/lib/repo";
import { optOutSchema } from "@/lib/query";

export const dynamic = "force-dynamic";

// Homeowner opt-out. Suppresses matching projects from the public map.
// This is a compliance requirement, not a nice-to-have — real home addresses
// are published, so this endpoint is a first-class part of the product.
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = optOutSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.flatten().fieldErrors },
      { status: 422 },
    );
  }

  const repo = await getRepo();
  const result = await repo.createOptOut(parsed.data);
  return NextResponse.json(
    {
      ok: true,
      suppressedCount: result.suppressedCount,
      message:
        "Your request has been recorded. Matching projects are now hidden from the public map.",
    },
    { status: 201 },
  );
}
