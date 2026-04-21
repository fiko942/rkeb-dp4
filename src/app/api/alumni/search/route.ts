import { NextRequest, NextResponse } from "next/server";

import { searchAlumni } from "@/lib/data-service";
import { requireUnlockedApi } from "@/lib/route-auth";

export async function GET(request: NextRequest) {
  const unauthorized = await requireUnlockedApi(request);
  if (unauthorized) {
    return unauthorized;
  }

  const query = request.nextUrl.searchParams.get("q")?.trim() ?? "";

  if (query.length < 2) {
    return NextResponse.json(
      {
        source: "mock",
        cached: false,
        records: [],
        fetchedAt: new Date().toISOString(),
        error: "Query minimal 2 karakter."
      },
      { status: 400 }
    );
  }

  try {
    const response = await searchAlumni(query);
    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      {
        source: "live",
        cached: false,
        records: [],
        fetchedAt: new Date().toISOString(),
        error:
          error instanceof Error
            ? error.message
            : "Terjadi error saat mengambil data alumni."
      },
      { status: 500 }
    );
  }
}
