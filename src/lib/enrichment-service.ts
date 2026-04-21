import { load } from "cheerio";

import { getServerCache, setServerCache } from "@/lib/cache-store";
import { getRuntimeEnv } from "@/lib/env";
import { getLocalPlaywrightPool } from "@/lib/playwright-local-pool";
import type {
  ContactEmail,
  EnrichmentApiResponse,
  EnrichmentProviderMeta,
  EnrichmentRequestPayload,
  EnrichmentTraceItem,
  PublicProfessionalAddress,
  SocialPlatform,
  SocialProfile
} from "@/lib/types";
import { buildCacheKey, dedupe, normalizeText, normalizeWhitespace } from "@/lib/utils";

const ENRICHMENT_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DISCOVERY_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const PROVIDER_COOLDOWN_TTL_MS = 30 * 60 * 1000;
const PLAYWRIGHT_DISCOVERY_VERSION = "playwright-search-v3";
const BRAVE_SEARCH_ENDPOINT = "https://api.search.brave.com/res/v1/web/search";
const GOOGLE_CSE_SEARCH_ENDPOINT = "https://www.googleapis.com/customsearch/v1";
const PLAYWRIGHT_SEARCH_ENDPOINT = "https://duckduckgo.com/html/";

type CandidatePlatform = SocialPlatform | "website";

interface SearchResultItem {
  link: string;
  title?: string;
  snippet?: string;
  platformHint?: CandidatePlatform;
  source: string;
  depth?: number;
  rootUrl?: string;
}

interface CandidateProfile {
  platform: CandidatePlatform;
  url: string;
  username?: string;
  displayName?: string;
  summaryText: string;
  emails: string[];
  addresses: string[];
  source: string;
}

interface ExtractedPageMetadata {
  title: string;
  description: string;
  jsonLdText: string;
  visibleText: string;
  emails: string[];
  addresses: string[];
  directProfileLinks: string[];
  crawlableLinks: string[];
  probableName: string;
}

interface SearchProviderResult {
  items: SearchResultItem[];
  warnings: string[];
  meta: EnrichmentProviderMeta;
}

interface DirectResolverResult {
  candidates: CandidateProfile[];
  followupItems: SearchResultItem[];
  warnings: string[];
  meta: EnrichmentProviderMeta;
}

interface DiscoveryCachePayload {
  provider: string;
  items: SearchResultItem[];
  fetchedAt: string;
}

interface ProviderCooldownPayload {
  provider: string;
  reason: string;
  cooldownUntil: string;
}

export interface CandidateDecision extends CandidateProfile {
  accepted: boolean;
  confidence: number;
  signals: string[];
  reason: string;
  nameScore: number;
}

export interface SearchProvider {
  name: string;
  searchCandidates(payload: EnrichmentRequestPayload): Promise<SearchProviderResult>;
}

export interface PageResolver {
  name: string;
  isAvailable(): boolean;
  resolve(url: string): Promise<ExtractedPageMetadata | null>;
  close(): Promise<void>;
}

export interface EnrichmentServiceOptions {
  cacheFilePath?: string;
  fetchImpl?: typeof fetch;
  pageResolver?: PageResolver;
  searchProviders?: SearchProvider[];
}

function getFetchImpl(fetchImpl?: typeof fetch) {
  return fetchImpl ?? fetch;
}

class ProviderRuntimeError extends Error {
  readonly code: "cooldown" | "failure";

  constructor(code: "cooldown" | "failure", message: string) {
    super(message);
    this.name = "ProviderRuntimeError";
    this.code = code;
  }
}

function getErrorDetail(error: unknown) {
  if (error instanceof Error) {
    return normalizeWhitespace(error.message) || error.name;
  }

  if (typeof error === "string") {
    return normalizeWhitespace(error) || "Unknown error";
  }

  try {
    return JSON.stringify(error);
  } catch {
    return "Unknown error";
  }
}

function logEnrichmentError(
  scope: string,
  context: Record<string, unknown>,
  error: unknown
) {
  console.error(`[AlmaTrace] ${scope}`, {
    ...context,
    error: getErrorDetail(error)
  });
}

function platformLabel(platform: CandidatePlatform) {
  switch (platform) {
    case "linkedin":
      return "LinkedIn";
    case "instagram":
      return "Instagram";
    case "x":
      return "X";
    case "github":
      return "GitHub";
    case "whatsapp":
      return "WhatsApp";
    default:
      return "web umum";
  }
}

function extractEmails(text: string) {
  return dedupe(
    Array.from(
      text.matchAll(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi),
      (match) => match[0].toLowerCase()
    )
  );
}

function safeUrl(url: string) {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

function clampSearchLimit(value: number) {
  if (!Number.isFinite(value)) {
    return 5;
  }

  return Math.max(3, Math.min(10, Math.floor(value)));
}

function normalizePublicUrl(url: string) {
  const trimmed = normalizeWhitespace(url);
  if (!trimmed) {
    return null;
  }

  const withProtocol = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed.replace(/^\/+/, "")}`;

  return safeUrl(withProtocol)?.toString() ?? null;
}

function resolveAbsoluteUrl(href: string, baseUrl?: string) {
  const trimmed = normalizeWhitespace(href);
  if (!trimmed || /^mailto:/i.test(trimmed) || /^javascript:/i.test(trimmed)) {
    return null;
  }

  try {
    return new URL(trimmed, baseUrl).toString();
  } catch {
    return null;
  }
}

export function unwrapSearchResultUrl(url: string) {
  const trimmed = normalizeWhitespace(url);
  if (!trimmed || /^mailto:/i.test(trimmed) || /^javascript:/i.test(trimmed)) {
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed, PLAYWRIGHT_SEARCH_ENDPOINT);
  } catch {
    return normalizePublicUrl(trimmed);
  }

  const hostname = parsed.hostname.replace(/^www\./, "").toLowerCase();
  if (hostname === "duckduckgo.com") {
    if (parsed.pathname.startsWith("/l/")) {
      const redirectTarget = parsed.searchParams.get("uddg");
      return redirectTarget ? normalizePublicUrl(decodeURIComponent(redirectTarget)) : null;
    }

    return null;
  }

  return parsed.protocol === "http:" || parsed.protocol === "https:"
    ? parsed.toString()
    : null;
}

function isLikelyCrawlableLink(url: string, baseUrl?: string) {
  const parsed = safeUrl(url);
  const base = baseUrl ? safeUrl(baseUrl) : null;
  if (!parsed) {
    return false;
  }

  if (base && parsed.hostname !== base.hostname) {
    return false;
  }

  if (isDirectProfileUrl(url)) {
    return false;
  }

  const normalizedPath = normalizeText(parsed.pathname);
  if (!normalizedPath || normalizedPath === " ") {
    return false;
  }

  const hints = [
    "about",
    "contact",
    "profile",
    "bio",
    "team",
    "people",
    "portfolio",
    "resume",
    "cv"
  ];

  return hints.some((hint) => normalizedPath.includes(hint));
}

function dedupeSearchItems(items: SearchResultItem[]) {
  const byUrl = new Map<string, SearchResultItem>();

  for (const item of items) {
    if (!byUrl.has(item.link)) {
      byUrl.set(item.link, item);
    }
  }

  return [...byUrl.values()];
}

function platformFromUrl(url: string): CandidatePlatform {
  const parsed = safeUrl(url);
  if (!parsed) {
    return "website";
  }

  const hostname = parsed.hostname.replace(/^www\./, "").toLowerCase();

  if (hostname === "github.com") {
    return "github";
  }

  if (hostname.endsWith("linkedin.com")) {
    return "linkedin";
  }

  if (hostname === "instagram.com") {
    return "instagram";
  }

  if (hostname === "x.com" || hostname === "twitter.com") {
    return "x";
  }

  if (
    hostname === "wa.me" ||
    hostname === "api.whatsapp.com" ||
    hostname === "chat.whatsapp.com" ||
    hostname === "whatsapp.com"
  ) {
    return "whatsapp";
  }

  return "website";
}

export function isDirectProfileUrl(url: string) {
  const parsed = safeUrl(url);
  if (!parsed) {
    return false;
  }

  const hostname = parsed.hostname.replace(/^www\./, "").toLowerCase();
  const path = parsed.pathname.replace(/\/+$/, "") || "/";
  const reserved = new Set([
    "",
    "/",
    "/search",
    "/explore",
    "/home",
    "/accounts",
    "/developer",
    "/i",
    "/intent"
  ]);

  if (hostname === "github.com") {
    return /^\/[^/]+$/.test(path) && !path.startsWith("/search");
  }

  if (hostname.endsWith("linkedin.com")) {
    return /^\/in\/[^/]+$/.test(path);
  }

  if (hostname === "instagram.com") {
    return /^\/[A-Za-z0-9._]+$/.test(path) && !reserved.has(path);
  }

  if (hostname === "x.com" || hostname === "twitter.com") {
    return /^\/[A-Za-z0-9_]+$/.test(path) && !reserved.has(path);
  }

  if (hostname === "wa.me") {
    return /^\/\d{7,20}$/.test(path);
  }

  if (hostname === "api.whatsapp.com") {
    return path === "/send" && /^\d{7,20}$/.test(parsed.searchParams.get("phone") ?? "");
  }

  if (hostname === "chat.whatsapp.com") {
    return /^\/[A-Za-z0-9]+$/.test(path);
  }

  if (hostname === "whatsapp.com") {
    return /^\/channel\/[A-Za-z0-9_-]+$/.test(path);
  }

  return false;
}

export function extractUsernameFromUrl(url: string) {
  const parsed = safeUrl(url);
  if (!parsed) {
    return "";
  }

  const platform = platformFromUrl(url);
  const segments = parsed.pathname.split("/").filter(Boolean);

  if (platform === "linkedin") {
    return segments[1] ?? "";
  }

  if (platform === "whatsapp") {
    if (parsed.hostname === "api.whatsapp.com") {
      return parsed.searchParams.get("phone") ?? "";
    }

    if (parsed.hostname === "whatsapp.com") {
      return segments[1] ?? "";
    }
  }

  return segments[0] ?? "";
}

function dedupeCandidates(candidates: CandidateProfile[]) {
  const byUrl = new Map<string, CandidateProfile>();

  for (const candidate of candidates) {
    const key = `${candidate.platform}:${candidate.url}`;
    const existing = byUrl.get(key);
    if (!existing) {
      byUrl.set(key, candidate);
      continue;
    }

    const existingScore =
      existing.emails.length * 6 +
      existing.addresses.length * 4 +
      existing.summaryText.length +
      (existing.displayName ? 12 : 0);
    const candidateScore =
      candidate.emails.length * 6 +
      candidate.addresses.length * 4 +
      candidate.summaryText.length +
      (candidate.displayName ? 12 : 0);

    byUrl.set(
      key,
      candidateScore >= existingScore
        ? {
            ...existing,
            ...candidate,
            emails: dedupe([...existing.emails, ...candidate.emails]),
            addresses: dedupe([...existing.addresses, ...candidate.addresses]),
            summaryText:
              candidate.summaryText.length >= existing.summaryText.length
                ? candidate.summaryText
                : existing.summaryText,
            displayName: candidate.displayName ?? existing.displayName,
            username: candidate.username ?? existing.username
          }
        : {
            ...candidate,
            ...existing,
            emails: dedupe([...candidate.emails, ...existing.emails]),
            addresses: dedupe([...candidate.addresses, ...existing.addresses]),
            summaryText:
              existing.summaryText.length >= candidate.summaryText.length
                ? existing.summaryText
                : candidate.summaryText,
            displayName: existing.displayName ?? candidate.displayName,
            username: existing.username ?? candidate.username
          }
    );
  }

  return [...byUrl.values()];
}

function extractAddressFromJsonValue(value: unknown, collector: string[]) {
  if (!value) {
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item) => extractAddressFromJsonValue(item, collector));
    return;
  }

  if (typeof value === "string") {
    collector.push(value);
    return;
  }

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const directAddress = record.address;

    if (typeof directAddress === "string") {
      collector.push(directAddress);
    } else if (directAddress) {
      const parts = [
        record.streetAddress,
        record.addressLocality,
        record.addressRegion,
        record.postalCode,
        record.addressCountry
      ]
        .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
        .map(normalizeWhitespace);

      if (parts.length > 0) {
        collector.push(parts.join(", "));
      }

      extractAddressFromJsonValue(directAddress, collector);
    }

    Object.values(record).forEach((item) => extractAddressFromJsonValue(item, collector));
  }
}

function cleanAddressCandidate(value: string) {
  return normalizeWhitespace(
    value
      .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, " ")
      .replace(/\s+/g, " ")
      .replace(/[|•]+/g, " ")
      .trim()
  );
}

function isLikelyPublicProfessionalAddress(value: string) {
  const cleaned = cleanAddressCandidate(value);
  if (cleaned.length < 4 || cleaned.length > 160) {
    return false;
  }

  const normalized = normalizeText(cleaned);
  const residentialHints = [
    "rumah",
    "home address",
    "residence",
    "apartemen",
    "apartment",
    "rt ",
    "rw ",
    "blok ",
    "komplek",
    "cluster",
    "perumahan",
    "gang "
  ];

  if (residentialHints.some((hint) => normalized.includes(normalizeText(hint)))) {
    return false;
  }

  const publicHints = [
    "university",
    "universitas",
    "kampus",
    "campus",
    "office",
    "studio",
    "laboratory",
    "lab",
    "research",
    "jakarta",
    "bandung",
    "surabaya",
    "yogyakarta",
    "indonesia",
    "city",
    "kota"
  ];

  if (publicHints.some((hint) => normalized.includes(normalizeText(hint)))) {
    return true;
  }

  return /^[A-Za-z\s.-]+,\s*[A-Za-z\s.-]+$/.test(cleaned);
}

function extractAddresses(text: string) {
  const collector = new Set<string>();
  const raw = text.replace(/\s+/g, " ");
  const locationMatches = raw.match(
    /\b(?:based in|located in|location|berbasis di|domisili|public location)\s*[:\-]?\s*([A-Za-z0-9.,\-\s]{3,100})/gi
  );

  for (const match of locationMatches ?? []) {
    const value = cleanAddressCandidate(match.replace(/^[^:,-]+[:\-]?\s*/i, ""));
    if (isLikelyPublicProfessionalAddress(value)) {
      collector.add(value);
    }
  }

  return [...collector];
}

function scoreNameSimilarity(expectedName: string, actualName: string) {
  const expected = normalizeText(expectedName);
  const actual = normalizeText(actualName);

  if (!expected || !actual) {
    return 0;
  }

  if (expected === actual) {
    return 1;
  }

  if (actual.includes(expected) || expected.includes(actual)) {
    return 0.94;
  }

  const expectedTokens = expected.split(" ").filter(Boolean);
  const actualTokens = actual.split(" ").filter(Boolean);

  if (!expectedTokens.length || !actualTokens.length) {
    return 0;
  }

  const overlap = expectedTokens.filter((token) => actualTokens.includes(token)).length;
  const baseScore = overlap / expectedTokens.length;
  const lengthPenalty = Math.abs(actualTokens.length - expectedTokens.length) > 2 ? 0.12 : 0;

  return Math.max(0, baseScore - lengthPenalty);
}

function collectSignals(payload: EnrichmentRequestPayload, combinedText: string) {
  const normalizedCombined = normalizeText(combinedText);
  const signals: string[] = [];

  const signalMatchers = [
    {
      label: "university",
      value: payload.university
    },
    {
      label: "university-short",
      value: payload.universityShort
    },
    {
      label: "major",
      value: payload.major
    },
    {
      label: "status",
      value: payload.status
    },
    {
      label: "entry-year",
      value: payload.entryYear
    }
  ];

  for (const matcher of signalMatchers) {
    if (!matcher.value) {
      continue;
    }

    const normalizedValue = normalizeText(matcher.value);
    if (normalizedValue && normalizedCombined.includes(normalizedValue)) {
      signals.push(matcher.label);
    }
  }

  return dedupe(signals);
}

function buildConfidence(nameScore: number, signals: string[], directProfile: boolean) {
  const signalWeight = Math.min(signals.length, 3) * 0.1;
  const directWeight = directProfile ? 0.08 : 0.04;
  return Math.min(0.99, Number((nameScore * 0.72 + signalWeight + directWeight).toFixed(2)));
}

export function scoreCandidate(
  payload: EnrichmentRequestPayload,
  candidate: CandidateProfile
): CandidateDecision {
  const probableName = candidate.displayName ?? candidate.summaryText;
  const nameScore = scoreNameSimilarity(payload.fullName, probableName);
  const directProfile = candidate.platform === "website" ? true : isDirectProfileUrl(candidate.url);
  const signals = collectSignals(
    payload,
    [
      candidate.displayName,
      candidate.summaryText,
      candidate.url,
      ...candidate.addresses
    ]
      .filter(Boolean)
      .join(" ")
  );
  const confidence = buildConfidence(nameScore, signals, directProfile);

  const accepted =
    nameScore >= 0.86 &&
    signals.length >= 1 &&
    directProfile &&
    (candidate.platform === "website" || Boolean(candidate.username));

  let reason = "candidate accepted";
  if (!directProfile) {
    reason = "URL bukan profile langsung.";
  } else if (nameScore < 0.86) {
    reason = "Nama publik tidak cukup cocok.";
  } else if (signals.length < 1) {
    reason = "Tidak ada sinyal kampus, prodi, status, atau tahun.";
  } else if (candidate.platform !== "website" && !candidate.username) {
    reason = "Username tidak bisa dibaca dari URL.";
  }

  return {
    ...candidate,
    nameScore,
    confidence,
    signals,
    accepted,
    reason
  };
}

export function extractPageMetadata(html: string, pageUrl?: string): ExtractedPageMetadata {
  const $ = load(html);
  const title =
    normalizeWhitespace($("title").first().text()) ||
    normalizeWhitespace($('meta[property="og:title"]').attr("content") ?? "");
  const description =
    normalizeWhitespace($('meta[name="description"]').attr("content") ?? "") ||
    normalizeWhitespace($('meta[property="og:description"]').attr("content") ?? "");
  const jsonLdBlocks = $("script[type='application/ld+json']")
    .map((_, node) => $(node).text())
    .get();
  const jsonLdText = jsonLdBlocks.join(" ");
  const visibleText = normalizeWhitespace($("body").text().slice(0, 5000));
  const probableName =
    normalizeWhitespace($("h1").first().text()) ||
    normalizeWhitespace($('meta[property="profile:username"]').attr("content") ?? "") ||
    title;

  const addressCollector = new Set<string>();
  const addressNodes = [
    $("address").text(),
    $('[itemprop="address"]').text(),
    $('[itemprop="streetAddress"]').text(),
    $('[itemprop="addressLocality"]').text(),
    $('[itemprop="addressRegion"]').text(),
    $('[itemprop="location"]').text(),
    $('meta[property="business:contact_data:street_address"]').attr("content") ?? "",
    $('meta[property="business:contact_data:locality"]').attr("content") ?? "",
    $('meta[property="business:contact_data:region"]').attr("content") ?? ""
  ];

  addressNodes
    .flatMap((value) => {
      const cleaned = cleanAddressCandidate(value);
      const extracted = extractAddresses(value);

      if (isLikelyPublicProfessionalAddress(cleaned)) {
        extracted.push(cleaned);
      }

      return extracted;
    })
    .forEach((value) => addressCollector.add(value));

  jsonLdBlocks.forEach((block) => {
    try {
      extractAddressFromJsonValue(JSON.parse(block), [...addressCollector]);
    } catch {
      block
        .split(/\n+/)
        .flatMap((value) => extractAddresses(value))
        .forEach((value) => addressCollector.add(value));
    }
  });

  const jsonAddressCollector: string[] = [];
  jsonLdBlocks.forEach((block) => {
    try {
      extractAddressFromJsonValue(JSON.parse(block), jsonAddressCollector);
    } catch {
      // Ignore invalid JSON-LD blocks.
    }
  });

  jsonAddressCollector
    .map(cleanAddressCandidate)
    .filter(isLikelyPublicProfessionalAddress)
    .forEach((value) => addressCollector.add(value));

  extractAddresses([description, visibleText].join(" "))
    .forEach((value) => addressCollector.add(value));

  const allLinks = dedupe(
    $("a[href]")
      .map((_, node) => resolveAbsoluteUrl($(node).attr("href") ?? "", pageUrl))
      .get()
      .filter((href): href is string => Boolean(href))
  );
  const mailtoEmails = $("a[href^='mailto:']")
    .map((_, node) => ($(node).attr("href") ?? "").replace(/^mailto:/i, ""))
    .get();
  const directProfileLinks = allLinks.filter(isDirectProfileUrl);
  const crawlableLinks = allLinks.filter((href) => isLikelyCrawlableLink(href, pageUrl)).slice(0, 3);

  return {
    title,
    description,
    jsonLdText,
    visibleText,
    probableName,
    directProfileLinks,
    crawlableLinks,
    emails: dedupe(
      extractEmails([html, description, jsonLdText, visibleText, ...mailtoEmails].join(" "))
    ),
    addresses: dedupe(
      [...addressCollector].map(cleanAddressCandidate).filter(isLikelyPublicProfessionalAddress)
    )
  };
}

function buildDiscoveryQueries(payload: EnrichmentRequestPayload) {
  const context = [payload.university, payload.universityShort, payload.major]
    .filter(Boolean)
    .join(" ");

  return [
    {
      platform: "website" as CandidatePlatform,
      query: `"${payload.fullName}" ${context}`
    },
    {
      platform: "linkedin" as CandidatePlatform,
      query: `site:linkedin.com/in "${payload.fullName}" ${context}`
    },
    {
      platform: "x" as CandidatePlatform,
      query: `("${payload.fullName}" ${context}) (site:x.com OR site:twitter.com)`
    },
    {
      platform: "whatsapp" as CandidatePlatform,
      query: `("${payload.fullName}" ${context}) ("wa.me" OR "api.whatsapp.com/send" OR "whatsapp.com/channel")`
    },
    {
      platform: "website" as CandidatePlatform,
      query: `"${payload.fullName}" ${context} (contact OR email OR alamat OR address OR about OR profile)`
    }
  ];
}

function extractDuckDuckGoSearchItems(
  html: string,
  platform: CandidatePlatform
): SearchResultItem[] {
  const $ = load(html);
  const items: SearchResultItem[] = [];

  $(".result").each((_, node) => {
    const anchor = $(node).find("a.result__a, a[href]").first();
    const rawLink = anchor.attr("href") ?? "";
    const link = unwrapSearchResultUrl(rawLink);

    if (!link) {
      return;
    }

    const title = normalizeWhitespace(anchor.text());
    const snippet = normalizeWhitespace(
      $(node).find(".result__snippet, .result-snippet").first().text()
    );

    items.push({
      link,
      title,
      snippet,
      platformHint: platform === "website" ? undefined : platform,
      source: `playwright-search:${platform}`
    });
  });

  if (items.length > 0) {
    return dedupeSearchItems(items);
  }

  const fallbackItems = $("a[href]")
    .map((_, node) => {
      const rawLink = $(node).attr("href") ?? "";
      const link = unwrapSearchResultUrl(rawLink);

      if (!link) {
        return null;
      }

      const item: SearchResultItem = {
        link,
        title: normalizeWhitespace($(node).text()) || undefined,
        snippet: "",
        platformHint: platform === "website" ? undefined : platform,
        source: `playwright-search:${platform}`
      };

      return item;
    })
    .get()
    .filter((item): item is SearchResultItem => item !== null)
    .filter((item) => {
      if (platform === "website") {
        return true;
      }

      return platformFromUrl(item.link) === platform;
    })
    .slice(0, 8);

  return dedupeSearchItems(fallbackItems);
}

function buildCandidateFromSearchItem(
  item: SearchResultItem,
  metadata?: ExtractedPageMetadata | null
): CandidateProfile {
  const platform = item.platformHint ?? platformFromUrl(item.link);
  const username =
    platform === "website" ? undefined : extractUsernameFromUrl(item.link) || undefined;

  return {
    platform,
    url: item.link,
    username,
    displayName: metadata?.probableName || normalizeWhitespace(item.title ?? ""),
    summaryText: normalizeWhitespace(
      [
        item.title,
        item.snippet,
        metadata?.description,
        metadata?.jsonLdText,
        metadata?.visibleText,
        ...(metadata?.addresses ?? [])
      ]
        .filter(Boolean)
        .join(" ")
    ),
    emails: dedupe(
      extractEmails(
        [
          item.snippet ?? "",
          metadata?.title ?? "",
          metadata?.description ?? "",
          ...(metadata?.emails ?? [])
        ].join(" ")
      )
    ),
    addresses: dedupe([
      ...(metadata?.addresses ?? []),
      ...extractAddresses(item.snippet ?? "")
    ]),
    source: item.source
  };
}

function buildCandidatesFromFollowupItem(
  item: SearchResultItem,
  metadata?: ExtractedPageMetadata | null
) {
  const baseCandidate = buildCandidateFromSearchItem(item, metadata);
  const relatedProfiles = (metadata?.directProfileLinks ?? []).flatMap((link) => {
    const relatedPlatform = platformFromUrl(link);
    const relatedUsername =
      relatedPlatform === "website" ? "" : extractUsernameFromUrl(link);

    if (relatedPlatform === "website" || !relatedUsername || !isDirectProfileUrl(link)) {
      return [];
    }

    return [
      {
        ...baseCandidate,
        platform: relatedPlatform,
        url: link,
        username: relatedUsername,
        displayName: metadata?.probableName || baseCandidate.displayName,
        source: `${item.source}->${relatedPlatform}`
      } satisfies CandidateProfile
    ];
  });

  return dedupeCandidates([baseCandidate, ...relatedProfiles]);
}

function createMeta(
  name: string,
  source: EnrichmentProviderMeta["source"]
): EnrichmentProviderMeta {
  return { name, source };
}

async function setProviderCooldown(
  cacheFilePath: string | undefined,
  providerName: string,
  reason: string
) {
  await setServerCache<ProviderCooldownPayload>(
    "discovery",
    `cooldown:${providerName}`,
    {
      provider: providerName,
      reason,
      cooldownUntil: new Date(Date.now() + PROVIDER_COOLDOWN_TTL_MS).toISOString()
    },
    PROVIDER_COOLDOWN_TTL_MS,
    providerName,
    cacheFilePath
  );
}

async function getProviderCooldown(
  cacheFilePath: string | undefined,
  providerName: string
) {
  return getServerCache<ProviderCooldownPayload>(
    "discovery",
    `cooldown:${providerName}`,
    cacheFilePath
  );
}

async function resolveGithubDirect(
  payload: EnrichmentRequestPayload,
  fetchImpl: typeof fetch
): Promise<DirectResolverResult> {
  const query = [`"${payload.fullName}"`, payload.universityShort, payload.major]
    .filter(Boolean)
    .join(" ");

  const searchResponse = await fetchImpl(
    `https://api.github.com/search/users?q=${encodeURIComponent(query)}&per_page=4`,
    {
      method: "GET",
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "AlmaTrace/1.0"
      },
      cache: "no-store"
    }
  );

  if (searchResponse.status === 403 || searchResponse.status === 429) {
    return {
      candidates: [],
      followupItems: [],
      warnings: ["GitHub rate limit reached."],
      meta: createMeta("github", "error")
    };
  }

  if (!searchResponse.ok) {
    return {
      candidates: [],
      followupItems: [],
      warnings: [`GitHub search failed with status ${searchResponse.status}.`],
      meta: createMeta("github", "error")
    };
  }

  const searchJson = (await searchResponse.json()) as {
    items?: Array<{ login: string; url: string }>;
  };

  const detailResults = await Promise.allSettled(
    (searchJson.items ?? []).map(async (item) => {
      const profileResponse = await fetchImpl(item.url, {
        method: "GET",
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "AlmaTrace/1.0"
        },
        cache: "no-store"
      });

      if (!profileResponse.ok) {
        return null;
      }

      const profile = (await profileResponse.json()) as {
        login: string;
        html_url: string;
        name?: string | null;
        bio?: string | null;
        company?: string | null;
        blog?: string | null;
        location?: string | null;
        email?: string | null;
        twitter_username?: string | null;
      };

      const addresses = [profile.location ?? ""]
        .map(cleanAddressCandidate)
        .filter(isLikelyPublicProfessionalAddress);

      const directCandidates: CandidateProfile[] = [
        {
          platform: "github",
          url: profile.html_url,
          username: profile.login,
          displayName: profile.name ?? profile.login,
          summaryText: normalizeWhitespace(
            [
              profile.name,
              profile.bio,
              profile.company,
              profile.location,
              profile.blog
            ]
              .filter(Boolean)
              .join(" ")
          ),
          emails: dedupe(
            extractEmails([profile.email ?? "", profile.bio ?? "", profile.blog ?? ""].join(" "))
          ),
          addresses,
          source: "github-public-profile"
        }
      ];

      const twitterUsername = normalizeWhitespace(profile.twitter_username ?? "");
      if (twitterUsername) {
        directCandidates.push({
          ...directCandidates[0],
          platform: "x",
          url: `https://x.com/${twitterUsername}`,
          username: twitterUsername,
          source: "github-public-profile->x"
        });
      }

      const followupItems: SearchResultItem[] = [];
      const blogUrl = normalizePublicUrl(profile.blog ?? "");
      if (blogUrl) {
        followupItems.push({
          link: blogUrl,
          title: profile.name ?? profile.login,
          snippet: normalizeWhitespace([profile.bio, profile.company].filter(Boolean).join(" ")),
          platformHint: "website",
          source: "github-blog"
        });
      }

      return {
        candidates: dedupeCandidates(directCandidates),
        followupItems
      };
    })
  );

  const candidates = detailResults.flatMap((result) =>
    result.status === "fulfilled" && result.value ? result.value.candidates : []
  );
  const followupItems = detailResults.flatMap((result) =>
    result.status === "fulfilled" && result.value ? result.value.followupItems : []
  );

  return {
    candidates: dedupeCandidates(candidates),
    followupItems: dedupeSearchItems(followupItems),
    warnings: [],
    meta: createMeta("github", "live")
  };
}

export class BraveSearchProvider implements SearchProvider {
  readonly name = "brave-search";

  private readonly fetchImpl: typeof fetch;
  private readonly cacheFilePath?: string;
  private readonly apiKey?: string;
  private readonly resultLimit: number;

  constructor(options: { fetchImpl?: typeof fetch; cacheFilePath?: string } = {}) {
    const runtimeEnv = getRuntimeEnv();
    this.fetchImpl = getFetchImpl(options.fetchImpl);
    this.cacheFilePath = options.cacheFilePath;
    this.apiKey = runtimeEnv.braveSearchApiKey;
    this.resultLimit = clampSearchLimit(runtimeEnv.enrichmentSearchMaxCandidates);
  }

  private buildCacheKey(payload: EnrichmentRequestPayload) {
    return buildCacheKey([
      PLAYWRIGHT_DISCOVERY_VERSION,
      this.name,
      payload.personId,
      payload.fullName,
      payload.university,
      payload.major
    ]);
  }

  private async fetchQuery(
    query: string,
    platform: CandidatePlatform
  ): Promise<SearchResultItem[]> {
    const response = await this.fetchImpl(
      `${BRAVE_SEARCH_ENDPOINT}?q=${encodeURIComponent(query)}&count=${this.resultLimit}`,
      {
        method: "GET",
        headers: {
          Accept: "application/json",
          "User-Agent": "AlmaTrace/1.0",
          "X-Subscription-Token": this.apiKey ?? ""
        },
        cache: "no-store"
      }
    );

    if (response.status === 403 || response.status === 429) {
      throw new Error("cooldown");
    }

    if (!response.ok) {
      throw new Error("temporary-unavailable");
    }

    const payload = (await response.json()) as {
      web?: {
        results?: Array<{
          url?: string;
          title?: string;
          description?: string;
          extra_snippets?: string[];
        }>;
      };
    };

    return (payload.web?.results ?? [])
      .filter((result): result is { url: string; title?: string; description?: string; extra_snippets?: string[] } =>
        Boolean(result.url)
      )
      .map((result) => ({
        link: result.url,
        title: result.title,
        snippet: normalizeWhitespace(
          [result.description, ...(result.extra_snippets ?? [])].filter(Boolean).join(" ")
        ),
        platformHint: platform === "website" ? undefined : platform,
        source: `brave-search:${platform}`
      }));
  }

  async searchCandidates(
    payload: EnrichmentRequestPayload
  ): Promise<SearchProviderResult> {
    if (!this.apiKey) {
      return {
        items: [],
        warnings: [],
        meta: createMeta(this.name, "disabled")
      };
    }

    const cooldown = await getProviderCooldown(
      this.cacheFilePath,
      `${this.name}:${PLAYWRIGHT_DISCOVERY_VERSION}`
    );
    if (cooldown.hit && cooldown.entry) {
      return {
        items: [],
        warnings: [cooldown.entry.value.reason],
        meta: createMeta(this.name, "cooldown")
      };
    }

    const cacheKey = this.buildCacheKey(payload);
    const cached = await getServerCache<DiscoveryCachePayload>(
      "discovery",
      cacheKey,
      this.cacheFilePath
    );

    if (cached.hit && cached.entry) {
      return {
        items: cached.entry.value.items,
        warnings: [],
        meta: createMeta(this.name, "cache")
      };
    }

    const queryConfigs = buildDiscoveryQueries(payload);
    const settledResults = await Promise.allSettled(
      queryConfigs.map(({ query, platform }) => this.fetchQuery(query, platform))
    );

    const cooldownTriggered = settledResults.some(
      (result) =>
        result.status === "rejected" &&
        result.reason instanceof Error &&
        result.reason.message === "cooldown"
    );

    if (cooldownTriggered) {
      await setProviderCooldown(
        this.cacheFilePath,
        this.name,
        "Brave Search temporarily cooling down."
      );
    }

    const warnings = dedupe(
      settledResults.flatMap((result) => {
        if (result.status === "fulfilled") {
          return [];
        }

        if (result.reason instanceof Error && result.reason.message === "cooldown") {
          return ["Brave Search temporarily cooling down."];
        }

        return ["Brave Search temporarily unavailable."];
      })
    );

    const items = dedupeSearchItems(
      settledResults.flatMap((result) => (result.status === "fulfilled" ? result.value : []))
    );

    if (items.length > 0 || warnings.length === 0) {
      await setServerCache<DiscoveryCachePayload>(
        "discovery",
        cacheKey,
        {
          provider: this.name,
          items,
          fetchedAt: new Date().toISOString()
        },
        DISCOVERY_CACHE_TTL_MS,
        payload.cacheKey,
        this.cacheFilePath
      );
    }

    return {
      items,
      warnings,
      meta: createMeta(this.name, items.length > 0 || warnings.length === 0 ? "live" : "error")
    };
  }
}

export class GoogleCseSearchProvider implements SearchProvider {
  readonly name = "google-cse";

  private readonly fetchImpl: typeof fetch;
  private readonly cacheFilePath?: string;
  private readonly apiKey?: string;
  private readonly engineId?: string;
  private readonly resultLimit: number;

  constructor(options: { fetchImpl?: typeof fetch; cacheFilePath?: string } = {}) {
    const runtimeEnv = getRuntimeEnv();
    this.fetchImpl = getFetchImpl(options.fetchImpl);
    this.cacheFilePath = options.cacheFilePath;
    this.apiKey = runtimeEnv.googleCseApiKey;
    this.engineId = runtimeEnv.googleCseEngineId;
    this.resultLimit = clampSearchLimit(runtimeEnv.enrichmentSearchMaxCandidates);
  }

  private buildCacheKey(payload: EnrichmentRequestPayload) {
    return buildCacheKey([
      PLAYWRIGHT_DISCOVERY_VERSION,
      this.name,
      payload.personId,
      payload.fullName,
      payload.university,
      payload.major
    ]);
  }

  private async fetchQuery(query: string, platform: CandidatePlatform) {
    const params = new URLSearchParams({
      key: this.apiKey ?? "",
      cx: this.engineId ?? "",
      q: query,
      num: String(this.resultLimit)
    });
    const response = await this.fetchImpl(
      `${GOOGLE_CSE_SEARCH_ENDPOINT}?${params.toString()}`,
      {
        method: "GET",
        headers: {
          Accept: "application/json",
          "User-Agent": "AlmaTrace/1.0"
        },
        cache: "no-store"
      }
    );

    if (response.status === 403 || response.status === 429) {
      throw new Error("cooldown");
    }

    if (!response.ok) {
      throw new Error("temporary-unavailable");
    }

    const payload = (await response.json()) as {
      items?: Array<{
        link?: string;
        title?: string;
        snippet?: string;
      }>;
    };

    return (payload.items ?? [])
      .filter((result): result is { link: string; title?: string; snippet?: string } =>
        Boolean(result.link)
      )
      .map((result) => ({
        link: result.link,
        title: result.title,
        snippet: normalizeWhitespace(result.snippet ?? ""),
        platformHint: platform === "website" ? undefined : platform,
        source: `google-cse:${platform}`
      }));
  }

  async searchCandidates(
    payload: EnrichmentRequestPayload
  ): Promise<SearchProviderResult> {
    if (!this.apiKey || !this.engineId) {
      return {
        items: [],
        warnings: [],
        meta: createMeta(this.name, "disabled")
      };
    }

    const cooldown = await getProviderCooldown(this.cacheFilePath, this.name);
    if (cooldown.hit && cooldown.entry) {
      return {
        items: [],
        warnings: [cooldown.entry.value.reason],
        meta: createMeta(this.name, "cooldown")
      };
    }

    const cacheKey = this.buildCacheKey(payload);
    const cached = await getServerCache<DiscoveryCachePayload>(
      "discovery",
      cacheKey,
      this.cacheFilePath
    );

    if (cached.hit && cached.entry) {
      return {
        items: cached.entry.value.items,
        warnings: [],
        meta: createMeta(this.name, "cache")
      };
    }

    const queryConfigs = buildDiscoveryQueries(payload);
    const settledResults = await Promise.allSettled(
      queryConfigs.map(({ query, platform }) => this.fetchQuery(query, platform))
    );

    const cooldownTriggered = settledResults.some(
      (result) =>
        result.status === "rejected" &&
        result.reason instanceof Error &&
        result.reason.message === "cooldown"
    );

    if (cooldownTriggered) {
      await setProviderCooldown(
        this.cacheFilePath,
        this.name,
        "Google CSE temporarily cooling down."
      );
    }

    const warnings = dedupe(
      settledResults.flatMap((result) => {
        if (result.status === "fulfilled") {
          return [];
        }

        if (result.reason instanceof Error && result.reason.message === "cooldown") {
          return ["Google CSE temporarily cooling down."];
        }

        return ["Google CSE temporarily unavailable."];
      })
    );

    const items = dedupeSearchItems(
      settledResults.flatMap((result) => (result.status === "fulfilled" ? result.value : []))
    );

    await setServerCache<DiscoveryCachePayload>(
      "discovery",
      cacheKey,
      {
        provider: this.name,
        items,
        fetchedAt: new Date().toISOString()
      },
      DISCOVERY_CACHE_TTL_MS,
      payload.cacheKey,
      this.cacheFilePath
    );

    return {
      items,
      warnings,
      meta: createMeta(this.name, items.length > 0 || warnings.length === 0 ? "live" : "error")
    };
  }
}

export class PlaywrightSearchProvider implements SearchProvider {
  readonly name = "playwright-search";

  private readonly cacheFilePath?: string;
  private readonly resultLimit: number;
  private readonly timeoutMs: number;

  constructor(options: { cacheFilePath?: string } = {}) {
    const runtimeEnv = getRuntimeEnv();
    this.cacheFilePath = options.cacheFilePath;
    this.resultLimit = clampSearchLimit(runtimeEnv.enrichmentSearchMaxCandidates);
    this.timeoutMs = Math.max(3_000, runtimeEnv.playwrightLaunchTimeoutMs);
  }

  private buildCacheKey(payload: EnrichmentRequestPayload) {
    return buildCacheKey([
      "discovery",
      this.name,
      payload.personId,
      payload.fullName,
      payload.university,
      payload.major
    ]);
  }

  private async fetchQuery(query: string, platform: CandidatePlatform) {
    return getLocalPlaywrightPool().run(async (context) => {
      const page = await context.newPage();
      await page.route("**/*", async (route) => {
        const resourceType = route.request().resourceType();
        if (
          resourceType === "image" ||
          resourceType === "media" ||
          resourceType === "font"
        ) {
          await route.abort();
          return;
        }

        await route.continue();
      });

      page.setDefaultNavigationTimeout(this.timeoutMs);

      try {
        try {
          await page.goto(
            `${PLAYWRIGHT_SEARCH_ENDPOINT}?q=${encodeURIComponent(query)}`,
            {
              waitUntil: "domcontentloaded",
              timeout: this.timeoutMs
            }
          );
          try {
            await page.waitForLoadState("networkidle", {
              timeout: Math.min(2_500, this.timeoutMs)
            });
          } catch {
            // Search pages may keep background requests active.
          }

          const html = await page.content();
          const bodyText = await page
            .textContent("body")
            .then((value) => value ?? "")
            .catch(() => "");
          const text = normalizeText(bodyText);
          if (
            text.includes("captcha") ||
            text.includes("unusual traffic") ||
            text.includes("detected automated traffic")
          ) {
            const message = `Pencarian browser untuk ${platformLabel(platform)} terkena challenge atau rate limit dari mesin pencari.`;
            console.warn("[AlmaTrace] Playwright search cooldown", {
              platform,
              query,
              message
            });
            throw new ProviderRuntimeError("cooldown", message);
          }

          return extractDuckDuckGoSearchItems(html, platform).slice(0, this.resultLimit);
        } catch (error) {
          if (error instanceof ProviderRuntimeError) {
            throw error;
          }

          const message = `Pencarian browser untuk ${platformLabel(platform)} gagal: ${getErrorDetail(error)}`;
          logEnrichmentError(
            "Playwright search query failed",
            { platform, query },
            error
          );
          throw new ProviderRuntimeError("failure", message);
        }
      } finally {
        await page.close();
      }
    });
  }

  async searchCandidates(
    payload: EnrichmentRequestPayload
  ): Promise<SearchProviderResult> {
    const cacheKey = this.buildCacheKey(payload);
    const cached = await getServerCache<DiscoveryCachePayload>(
      "discovery",
      cacheKey,
      this.cacheFilePath
    );

    if (cached.hit && cached.entry) {
      return {
        items: cached.entry.value.items,
        warnings: [],
        meta: createMeta(this.name, "cache")
      };
    }

    const cooldown = await getProviderCooldown(
      this.cacheFilePath,
      `${this.name}:${PLAYWRIGHT_DISCOVERY_VERSION}`
    );
    if (cooldown.hit && cooldown.entry) {
      return {
        items: [],
        warnings: [cooldown.entry.value.reason],
        meta: createMeta(this.name, "cooldown")
      };
    }

    const queryConfigs = buildDiscoveryQueries(payload);
    const settledResults = await Promise.allSettled(
      queryConfigs.map(({ query, platform }) => this.fetchQuery(query, platform))
    );

    const cooldownTriggered = settledResults.some(
      (result) =>
        result.status === "rejected" &&
        result.reason instanceof ProviderRuntimeError &&
        result.reason.code === "cooldown"
    );

    if (cooldownTriggered) {
      await setProviderCooldown(
        this.cacheFilePath,
        `${this.name}:${PLAYWRIGHT_DISCOVERY_VERSION}`,
        "Pencarian browser sedang terkena challenge atau rate limit dari mesin pencari."
      );
    }

    const warnings = dedupe(
      settledResults.flatMap((result) => {
        if (result.status === "fulfilled") {
          return [];
        }

        if (result.reason instanceof ProviderRuntimeError) {
          return [result.reason.message];
        }

        return [
          `Pencarian browser gagal karena error yang tidak dikenali: ${getErrorDetail(result.reason)}`
        ];
      })
    );

    const items = dedupeSearchItems(
      settledResults.flatMap((result) => (result.status === "fulfilled" ? result.value : []))
    );

    await setServerCache<DiscoveryCachePayload>(
      "discovery",
      cacheKey,
      {
        provider: this.name,
        items,
        fetchedAt: new Date().toISOString()
      },
      DISCOVERY_CACHE_TTL_MS,
      payload.cacheKey,
      this.cacheFilePath
    );

    return {
      items,
      warnings,
      meta: createMeta(this.name, items.length > 0 || warnings.length === 0 ? "live" : "error")
    };
  }
}

export class LocalPlaywrightResolver implements PageResolver {
  readonly name = "playwright-local";

  private readonly timeoutMs: number;

  constructor() {
    const runtimeEnv = getRuntimeEnv();
    this.timeoutMs = Number.isFinite(runtimeEnv.playwrightLaunchTimeoutMs)
      ? runtimeEnv.playwrightLaunchTimeoutMs
      : 15_000;
  }

  isAvailable() {
    return true;
  }

  async resolve(url: string): Promise<ExtractedPageMetadata | null> {
    try {
      return await getLocalPlaywrightPool().run(async (context) => {
        const page = await context.newPage();
        await page.route("**/*", async (route) => {
          const resourceType = route.request().resourceType();
          if (
            resourceType === "image" ||
            resourceType === "media" ||
            resourceType === "font"
          ) {
            await route.abort();
            return;
          }

          await route.continue();
        });

        page.setDefaultNavigationTimeout(this.timeoutMs);

        try {
          await page.goto(url, {
            waitUntil: "domcontentloaded",
            timeout: this.timeoutMs
          });
          try {
            await page.waitForLoadState("networkidle", {
              timeout: Math.min(2_500, this.timeoutMs)
            });
          } catch {
            // Some sites keep long-polling connections open.
          }

          return extractPageMetadata(await page.content(), url);
        } finally {
          await page.close();
        }
      });
    } catch (error) {
      logEnrichmentError("Playwright follow-up failed", { url }, error);
      return null;
    }
  }

  async close() {
    return;
  }
}

function buildEnrichmentCacheKey(payload: EnrichmentRequestPayload) {
  return buildCacheKey([
    "enrichment-v3",
    payload.cacheKey || "enrichment",
    payload.personId,
    payload.fullName,
    payload.university,
    payload.major
  ]);
}

function shouldOpenWithBrowser(item: SearchResultItem) {
  const platform = item.platformHint ?? platformFromUrl(item.link);
  return platform === "website" || isDirectProfileUrl(item.link);
}

function getBrowserPriority(item: SearchResultItem) {
  const platform = item.platformHint ?? platformFromUrl(item.link);
  const basePriority = platform === "website" ? 1 : 0;
  return basePriority + (item.depth ?? 0) * 10;
}

function createTraceItem(
  stage: EnrichmentTraceItem["stage"],
  status: EnrichmentTraceItem["status"],
  url: string,
  source: string,
  detail: string
): EnrichmentTraceItem {
  return {
    stage,
    status,
    url,
    source,
    detail
  };
}

function buildDecisionTrace(
  decision: CandidateDecision,
  browserVisitedUrls: ReadonlySet<string>
): EnrichmentTraceItem {
  const detail = decision.accepted
    ? `confidence ${decision.confidence.toFixed(2)} · signals ${decision.signals.join(", ")}`
    : `${decision.reason} confidence ${decision.confidence.toFixed(2)}`;

  return createTraceItem(
    browserVisitedUrls.has(decision.url) ? "browser" : "discovery",
    decision.accepted ? "accepted" : "rejected",
    decision.url,
    decision.source,
    detail
  );
}

function dedupeTrace(trace: EnrichmentTraceItem[]) {
  const byKey = new Map<string, EnrichmentTraceItem>();

  for (const item of trace) {
    const key = `${item.stage}:${item.status}:${item.url}:${item.source}`;
    if (!byKey.has(key)) {
      byKey.set(key, item);
    }
  }

  return [...byKey.values()];
}

function selectProfiles(decisions: CandidateDecision[]): SocialProfile[] {
  const filtered = decisions.filter(
    (
      decision
    ): decision is CandidateDecision & {
      platform: SocialPlatform;
      username: string;
    } =>
      decision.accepted &&
      decision.platform !== "website" &&
      Boolean(decision.username) &&
      isDirectProfileUrl(decision.url)
  );

  const byPlatform = new Map<SocialPlatform, SocialProfile>();

  for (const decision of filtered) {
    const current = byPlatform.get(decision.platform);
    const nextProfile: SocialProfile = {
      platform: decision.platform,
      username: decision.username,
      url: decision.url,
      source: decision.source,
      confidence: decision.confidence
    };

    if (!current || nextProfile.confidence > current.confidence) {
      byPlatform.set(decision.platform, nextProfile);
    }
  }

  return [...byPlatform.values()].sort((left, right) => right.confidence - left.confidence);
}

function selectEmail(decisions: CandidateDecision[]): ContactEmail | undefined {
  const matched = decisions
    .filter((decision) => decision.accepted && decision.emails.length > 0)
    .sort((left, right) => right.confidence - left.confidence)[0];

  if (!matched) {
    return undefined;
  }

  return {
    value: matched.emails[0],
    source: matched.source,
    verifiedBy: matched.signals.join(", ")
  };
}

function selectAddress(
  decisions: CandidateDecision[]
): PublicProfessionalAddress | undefined {
  const matched = decisions
    .filter((decision) => decision.accepted && decision.addresses.length > 0)
    .sort((left, right) => right.confidence - left.confidence)[0];

  if (!matched) {
    return undefined;
  }

  const value = matched.addresses.find((address) =>
    isLikelyPublicProfessionalAddress(address)
  );

  if (!value) {
    return undefined;
  }

  return {
    label: matched.platform === "website" ? "Alamat publik" : "Lokasi profesional",
    value,
    source: matched.source,
    verifiedBy: matched.signals.join(", ")
  };
}

export async function enrichPerson(
  payload: EnrichmentRequestPayload,
  options: EnrichmentServiceOptions = {}
): Promise<EnrichmentApiResponse> {
  const cacheKey = buildEnrichmentCacheKey(payload);
  const cacheResult = await getServerCache<EnrichmentApiResponse>(
    "enrichment",
    cacheKey,
    options.cacheFilePath
  );

  if (cacheResult.hit && cacheResult.entry) {
    return {
      ...cacheResult.entry.value,
      source: "cache"
    };
  }

  const runtimeEnv = getRuntimeEnv();
  const browserFollowupLimit = Math.max(
    4,
    clampSearchLimit(runtimeEnv.enrichmentSearchMaxCandidates) + 2
  );
  const githubResult: DirectResolverResult = {
    candidates: [],
    followupItems: [],
    warnings: [],
    meta: createMeta("github", "skipped")
  };
  const configuredProviders = [
    new PlaywrightSearchProvider({ cacheFilePath: options.cacheFilePath })
  ];
  const searchProviders = options.searchProviders ?? configuredProviders;
  const providerResults = await Promise.all(
    searchProviders.map((provider) => provider.searchCandidates(payload))
  );
  const resolver = options.pageResolver ?? new LocalPlaywrightResolver();

  const providerItems = dedupeSearchItems(providerResults.flatMap((result) => result.items));
  const providerWarnings = providerResults.flatMap((result) => result.warnings);
  const trace: EnrichmentTraceItem[] = [
    ...githubResult.candidates.map((candidate) =>
      createTraceItem(
        "discovery",
        "candidate",
        candidate.url,
        candidate.source,
        "Candidate direct ditemukan dari GitHub."
      )
    ),
    ...providerItems.map((item) =>
      createTraceItem(
        "discovery",
        "candidate",
        item.link,
        item.source,
        (item.platformHint ?? platformFromUrl(item.link)) === "website"
          ? "Candidate website ditemukan."
          : "Candidate profile publik ditemukan."
      )
    )
  ];

  const directCandidates = [
    ...githubResult.candidates,
    ...providerItems
      .filter((item) => isDirectProfileUrl(item.link))
      .map((item) => buildCandidateFromSearchItem(item))
  ];

  const followupQueue = dedupeSearchItems([
    ...githubResult.followupItems,
    ...providerItems.filter(shouldOpenWithBrowser)
  ]).sort((left, right) => getBrowserPriority(left) - getBrowserPriority(right));

  let browserFollowupMs = 0;
  let browserVisitedCount = 0;
  const browserVisitedUrls = new Set<string>();
  let browserMeta = createMeta(resolver.name, resolver.isAvailable() ? "live" : "disabled");
  const browserWarnings: string[] = [];
  const websiteCandidates: CandidateProfile[] = [];

  if (followupQueue.length > 0 && resolver.isAvailable()) {
    const startedAt = Date.now();
    try {
      while (followupQueue.length > 0 && browserVisitedUrls.size < browserFollowupLimit) {
        const item = followupQueue.shift();
        if (!item || browserVisitedUrls.has(item.link)) {
          continue;
        }

        browserVisitedUrls.add(item.link);
        trace.push(
          createTraceItem(
            "browser",
            "opened",
            item.link,
            item.source,
            item.depth
              ? `Membuka follow-up level ${item.depth}.`
              : "Membuka halaman publik untuk verifikasi lanjut."
          )
        );

        const metadata = await resolver.resolve(item.link);
        if (!metadata) {
          trace.push(
            createTraceItem(
              "browser",
              "blocked",
              item.link,
              item.source,
              "Halaman tidak bisa diambil, dirender, atau dibaca."
            )
          );
          continue;
        }

        websiteCandidates.push(...buildCandidatesFromFollowupItem(item, metadata));
        trace.push(
          createTraceItem(
            "browser",
            "candidate",
            item.link,
            item.source,
            `Email ${metadata.emails.length}, alamat ${metadata.addresses.length}, direct link ${metadata.directProfileLinks.length}.`
          )
        );

        if ((item.depth ?? 0) < 1) {
          const crawlItems = metadata.crawlableLinks
            .slice(0, 2)
            .map(
              (link) =>
                ({
                  link,
                  title: metadata.probableName || item.title,
                  snippet: metadata.description,
                  platformHint:
                    platformFromUrl(link) === "website"
                      ? "website"
                      : (platformFromUrl(link) as CandidatePlatform),
                  source: `${item.source}->crawl`,
                  depth: (item.depth ?? 0) + 1,
                  rootUrl: item.rootUrl ?? item.link
                }) satisfies SearchResultItem
            );

          followupQueue.push(...crawlItems);
          followupQueue.sort((left, right) => getBrowserPriority(left) - getBrowserPriority(right));
        }
      }
    } catch {
      browserWarnings.push("Local Playwright follow-up unavailable.");
      browserMeta = createMeta(resolver.name, "error");
    } finally {
      browserFollowupMs = Date.now() - startedAt;
      browserVisitedCount = browserVisitedUrls.size;
      await resolver.close();
    }
  } else if (followupQueue.length > 0) {
    browserWarnings.push("Local Playwright follow-up unavailable.");
    trace.push(
      ...followupQueue.slice(0, 4).map((item) =>
        createTraceItem(
          "browser",
          "skipped",
          item.link,
          item.source,
          "Local Playwright tidak aktif, jadi halaman ini tidak dibuka."
        )
      )
    );
  }

  const decisions = dedupeCandidates([...directCandidates, ...websiteCandidates]).map(
    (candidate) => scoreCandidate(payload, candidate)
  );
  trace.push(...decisions.map((decision) => buildDecisionTrace(decision, browserVisitedUrls)));
  const selectedEmail = selectEmail(decisions);
  const selectedAddress = selectAddress(decisions);
  const discoverySources = providerResults.map((result) => result.meta.source);
  const discoveryCache =
    discoverySources.includes("cache")
      ? "hit"
      : discoverySources.includes("live")
        ? "miss"
        : "skipped";

  const response: EnrichmentApiResponse = {
    source: "live",
    ...(selectedEmail ? { email: selectedEmail } : {}),
    ...(selectedAddress ? { address: selectedAddress } : {}),
    profiles: selectProfiles(decisions),
    warnings: dedupe([
      ...githubResult.warnings,
      ...providerWarnings,
      ...browserWarnings
    ]),
    meta: {
      providers: [...providerResults.map((result) => result.meta), browserMeta],
      discoveryCache,
      browserFollowupMs,
      browserVisitedCount
    },
    trace: dedupeTrace(trace)
  };

  await setServerCache(
    "enrichment",
    cacheKey,
    response,
    ENRICHMENT_CACHE_TTL_MS,
    payload.cacheKey,
    options.cacheFilePath
  );

  return response;
}
