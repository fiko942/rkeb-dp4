import { buildCacheKey } from "@/lib/utils";

export function buildSearchCacheKey(query: string) {
  return buildCacheKey(["search-v2", query.trim().toLowerCase()]);
}
