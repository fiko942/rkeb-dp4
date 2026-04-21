import { NextRequest, NextResponse } from "next/server";

import { enrichPerson } from "@/lib/enrichment-service";
import type { EnrichmentRequestPayload } from "@/lib/types";
import { requireUnlockedApi } from "@/lib/route-auth";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const unauthorized = await requireUnlockedApi(request);
  if (unauthorized) {
    return unauthorized;
  }

  try {
    const payload = (await request.json()) as Partial<EnrichmentRequestPayload>;

    if (!payload.fullName || !payload.personId || !payload.cacheKey) {
      return NextResponse.json(
        {
          error: "Payload enrichment tidak lengkap."
        },
        { status: 400 }
      );
    }

    const response = await enrichPerson(payload as EnrichmentRequestPayload);
    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      {
        source: "live",
        profiles: [],
        warnings: [],
        error:
          error instanceof Error
            ? error.message
            : "Terjadi error saat enrichment."
      },
      { status: 500 }
    );
  }
}
