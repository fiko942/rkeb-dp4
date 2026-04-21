export type CacheNamespace = "search" | "discovery" | "enrichment";
export type SearchSource = "mock" | "live" | "cache";
export type EnrichmentSource = "live" | "cache";
export type DataMode = "mock" | "live";
export type SocialPlatform = "github" | "linkedin" | "instagram" | "x" | "whatsapp";

export interface NormalizedAlumniRecord {
  id: string;
  name: string;
  nim: string;
  university: string;
  universityShort: string;
  major: string;
  status: string;
  entryYear: string;
  email?: string;
  raw?: Record<string, unknown>;
}

export interface SearchApiResponse {
  source: SearchSource;
  provider?: string;
  cached: boolean;
  records: NormalizedAlumniRecord[];
  fetchedAt: string;
  error?: string;
}

export interface ContactEmail {
  value: string;
  source: string;
  verifiedBy: string;
}

export interface PublicProfessionalAddress {
  label: string;
  value: string;
  source: string;
  verifiedBy: string;
}

export interface SocialProfile {
  platform: SocialPlatform;
  username: string;
  url: string;
  source: string;
  confidence: number;
}

export interface EnrichmentProviderMeta {
  name: string;
  source: "live" | "cache" | "cooldown" | "disabled" | "skipped" | "error";
}

export interface EnrichmentTraceItem {
  url: string;
  stage: "discovery" | "browser";
  source: string;
  status: "candidate" | "opened" | "accepted" | "rejected" | "blocked" | "error" | "skipped";
  detail: string;
}

export interface EnrichmentMeta {
  providers: EnrichmentProviderMeta[];
  discoveryCache: "hit" | "miss" | "skipped";
  browserFollowupMs: number;
  browserVisitedCount: number;
}

export interface EnrichmentRequestPayload {
  personId: string;
  fullName: string;
  university?: string;
  universityShort?: string;
  major?: string;
  status?: string;
  entryYear?: string;
  cacheKey: string;
}

export interface EnrichmentApiResponse {
  source: EnrichmentSource;
  email?: ContactEmail;
  address?: PublicProfessionalAddress;
  profiles: SocialProfile[];
  warnings: string[];
  meta?: EnrichmentMeta;
  trace?: EnrichmentTraceItem[];
}

export interface CacheEntry<T> {
  value: T;
  createdAt: string;
  expiresAt: string;
  sourceKey: string;
}

export interface CacheStore {
  search: Record<string, CacheEntry<SearchApiResponse>>;
  discovery: Record<string, CacheEntry<unknown>>;
  enrichment: Record<string, CacheEntry<EnrichmentApiResponse>>;
}

export interface CacheSummary {
  namespace: CacheNamespace;
  total: number;
  fresh: number;
  expired: number;
}

export interface CacheStatusResponse {
  summaries: CacheSummary[];
  updatedAt: string;
}

export interface CacheReadResult<T> {
  hit: boolean;
  stale: boolean;
  entry?: CacheEntry<T>;
}
