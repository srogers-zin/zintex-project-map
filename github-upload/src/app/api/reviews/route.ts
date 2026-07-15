import { NextRequest, NextResponse } from "next/server";
import { getRepo } from "@/lib/repo";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const repo = await getRepo();
  const locationsParam = req.nextUrl.searchParams.get("locations");
  const locationIds = locationsParam
    ? locationsParam.split(",").map((s) => s.trim()).filter(Boolean)
    : undefined;
  const reviews = await repo.getReviews(locationIds);

  const count = reviews.length;
  const avg = count ? reviews.reduce((s, r) => s + r.rating, 0) / count : 0;
  return NextResponse.json({
    reviews,
    count,
    averageRating: Math.round(avg * 10) / 10,
  });
}
