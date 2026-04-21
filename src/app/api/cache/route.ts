import { NextRequest, NextResponse } from "next/server";

import {
  getCacheStatus,
  getServerCache,
  setServerCache
} from "@/lib/cache-store";
import type {
  CacheNamespace,
  EnrichmentApiResponse,
  SearchApiResponse
} from "@/lib/types";
import { requireUnlockedApi } from "@/lib/route-auth";

function isNamespace(value: string | null): value is CacheNamespace {
  return value === "search" || value === "discovery" || value === "enrichment";
}

export async function GET(request: NextRequest) {
  const unauthorized = await requireUnlockedApi(request);
  if (unauthorized) {
    return unauthorized;
  }

  const namespace = request.nextUrl.searchParams.get("namespace");
  const key = request.nextUrl.searchParams.get("key");

  if (isNamespace(namespace) && key) {
    const entry =
      namespace === "search"
        ? await getServerCache<SearchApiResponse>("search", key)
        : namespace === "enrichment"
          ? await getServerCache<EnrichmentApiResponse>("enrichment", key)
          : await getServerCache<unknown>("discovery", key);

    return NextResponse.json(
      {
        namespace,
        key,
        ...entry
      },
      { status: 200 }
    );
  }

  return NextResponse.json(await getCacheStatus(), { status: 200 });
}

export async function POST(request: NextRequest) {
  const unauthorized = await requireUnlockedApi(request);
  if (unauthorized) {
    return unauthorized;
  }

  const payload = (await request.json()) as {
    namespace?: CacheNamespace;
    key?: string;
    value?: unknown;
    ttlMs?: number;
    sourceKey?: string;
  };

  if (!payload.namespace || !payload.key || !payload.value) {
    return NextResponse.json({ error: "Payload cache tidak lengkap." }, { status: 400 });
  }

  const entry = await setServerCache(
    payload.namespace,
    payload.key,
    payload.value,
    payload.ttlMs ?? 60_000,
    payload.sourceKey ?? payload.key
  );

  return NextResponse.json({ ok: true, entry }, { status: 200 });
}
