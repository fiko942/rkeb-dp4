import type { SearchApiResponse } from "@/lib/types";
import { buildSearchCacheKey } from "@/lib/search-cache-key";

const CLIENT_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CLIENT_CACHE_PREFIX = "almatrace_cache_";

interface ClientCacheValue {
  cachedAt: number;
  response: SearchApiResponse;
}

function getClientStorageKey(query: string) {
  return `${CLIENT_CACHE_PREFIX}${buildSearchCacheKey(query)}`;
}

export function getClientSearchCache(query: string) {
  if (typeof window === "undefined") {
    return null;
  }

  const raw = window.localStorage.getItem(getClientStorageKey(query));
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as ClientCacheValue;
    if (Date.now() - parsed.cachedAt > CLIENT_CACHE_TTL_MS) {
      window.localStorage.removeItem(getClientStorageKey(query));
      return null;
    }

    return parsed.response;
  } catch {
    window.localStorage.removeItem(getClientStorageKey(query));
    return null;
  }
}

export function setClientSearchCache(query: string, response: SearchApiResponse) {
  if (typeof window === "undefined") {
    return;
  }

  const payload: ClientCacheValue = {
    cachedAt: Date.now(),
    response
  };

  window.localStorage.setItem(getClientStorageKey(query), JSON.stringify(payload));
}
