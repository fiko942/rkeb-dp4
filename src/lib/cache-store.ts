import { promises as fs } from "fs";
import path from "path";

import type {
  CacheEntry,
  CacheNamespace,
  CacheReadResult,
  CacheStatusResponse,
  CacheStore
} from "@/lib/types";
import { safeJsonParse } from "@/lib/utils";

const DEFAULT_CACHE_PATH = path.join(process.cwd(), "data", "cache.json");

const EMPTY_CACHE_STORE: CacheStore = {
  search: {},
  discovery: {},
  enrichment: {}
};

function getCachePath(cacheFilePath?: string) {
  return cacheFilePath ?? DEFAULT_CACHE_PATH;
}

async function ensureCacheFile(cacheFilePath?: string) {
  const resolvedPath = getCachePath(cacheFilePath);
  await fs.mkdir(path.dirname(resolvedPath), { recursive: true });

  try {
    await fs.access(resolvedPath);
  } catch {
    await fs.writeFile(
      resolvedPath,
      JSON.stringify(EMPTY_CACHE_STORE, null, 2),
      "utf8"
    );
  }

  return resolvedPath;
}

export async function readCacheStore(cacheFilePath?: string): Promise<CacheStore> {
  const resolvedPath = await ensureCacheFile(cacheFilePath);

  try {
    const raw = await fs.readFile(resolvedPath, "utf8");
    const parsed = safeJsonParse<CacheStore>(raw, EMPTY_CACHE_STORE);

    return {
      search: parsed.search ?? {},
      discovery: parsed.discovery ?? {},
      enrichment: parsed.enrichment ?? {}
    };
  } catch {
    await writeCacheStore(EMPTY_CACHE_STORE, resolvedPath);
    return structuredClone(EMPTY_CACHE_STORE);
  }
}

export async function writeCacheStore(
  store: CacheStore,
  cacheFilePath?: string
) {
  const resolvedPath = await ensureCacheFile(cacheFilePath);
  await fs.writeFile(resolvedPath, JSON.stringify(store, null, 2), "utf8");
}

export async function getServerCache<T>(
  namespace: CacheNamespace,
  key: string,
  cacheFilePath?: string
): Promise<CacheReadResult<T>> {
  const store = await readCacheStore(cacheFilePath);
  const entry = store[namespace][key] as CacheEntry<T> | undefined;

  if (!entry) {
    return { hit: false, stale: false };
  }

  const isFresh = new Date(entry.expiresAt).getTime() > Date.now();
  return {
    hit: isFresh,
    stale: !isFresh,
    entry
  };
}

export async function setServerCache<T>(
  namespace: CacheNamespace,
  key: string,
  value: T,
  ttlMs: number,
  sourceKey: string,
  cacheFilePath?: string
) {
  const store = await readCacheStore(cacheFilePath);
  const createdAt = new Date().toISOString();
  const entry: CacheEntry<T> = {
    value,
    sourceKey,
    createdAt,
    expiresAt: new Date(Date.now() + ttlMs).toISOString()
  };

  (store[namespace] as Record<string, CacheEntry<T>>)[key] = entry;

  await writeCacheStore(store, cacheFilePath);
  return entry;
}

export async function getCacheStatus(
  cacheFilePath?: string
): Promise<CacheStatusResponse> {
  const store = await readCacheStore(cacheFilePath);
  const now = Date.now();

  const summaries = (Object.keys(store) as CacheNamespace[]).map((namespace) => {
    const entries = Object.values(store[namespace]);
    const fresh = entries.filter(
      (entry) => new Date(entry.expiresAt).getTime() > now
    ).length;

    return {
      namespace,
      total: entries.length,
      fresh,
      expired: entries.length - fresh
    };
  });

  return {
    summaries,
    updatedAt: new Date().toISOString()
  };
}
