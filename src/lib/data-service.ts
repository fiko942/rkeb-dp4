import { getRuntimeEnv } from "@/lib/env";
import { getServerCache, setServerCache } from "@/lib/cache-store";
import { mockAlumniPayload } from "@/lib/mock-data";
import { buildSearchCacheKey } from "@/lib/search-cache-key";
import type { DataMode, NormalizedAlumniRecord, SearchApiResponse } from "@/lib/types";
import { buildCacheKey, normalizeText, normalizeWhitespace, titleCase } from "@/lib/utils";

const SERVER_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

type RawRecord = Record<string, unknown>;

export interface SearchServiceOptions {
  cacheFilePath?: string;
  fetchImpl?: typeof fetch;
  dataMode?: DataMode;
  upstreamUrl?: string;
  upstreamFallbackUrls?: string[];
  upstreamToken?: string;
  upstreamHeaders?: Record<string, string>;
  upstreamQueryParam?: string;
}

interface PddiktiSearchItem {
  id?: string;
  nama?: string;
  nim?: string;
  nama_pt?: string;
  sinkatan_pt?: string;
  nama_prodi?: string;
}

interface PddiktiStudentDetail {
  id?: string;
  nama_pt?: string;
  kode_pt?: string;
  prodi?: string;
  nama?: string;
  nim?: string;
  jenis_daftar?: string;
  jenis_kelamin?: string;
  jenjang?: string;
  status_saat_ini?: string;
  tanggal_masuk?: string;
  id_pt?: string;
}

function pickString(record: RawRecord, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return normalizeWhitespace(value);
    }
  }

  return "";
}

function deriveUniversityShort(university: string) {
  const tokens = university
    .split(" ")
    .filter((token) => token.length > 2)
    .map((token) => token[0])
    .join("");

  return tokens ? tokens.toLowerCase() : normalizeText(university).replace(/\s+/g, "");
}

export function normalizeAlumniRecord(record: RawRecord): NormalizedAlumniRecord {
  const university = pickString(record, ["nama_pt", "pt", "university"]);
  const universityShort =
    pickString(record, [
      "singkatan_pt",
      "pt_singkat",
      "sinkatan_pt",
      "nm_singkat",
      "university_short"
    ]) ||
    deriveUniversityShort(university);
  const name = pickString(record, ["nama", "nama_lengkap", "full_name", "name"]);
  const nim = pickString(record, ["nim", "nomor_induk", "student_id"]);
  const major = pickString(record, ["nama_prodi", "prodi", "major"]);
  const status = pickString(record, [
    "status",
    "status_kuliah",
    "status_mahasiswa",
    "status_saat_ini"
  ]);
  const rawEntryYear = pickString(record, [
    "angkatan",
    "tahun_masuk",
    "entry_year",
    "entryYear",
    "tanggal_masuk"
  ]);
  const entryYear =
    /^\d{4}-\d{2}-\d{2}/.test(rawEntryYear) ? rawEntryYear.slice(0, 4) : rawEntryYear;
  const email = pickString(record, [
    "email",
    "email_mahasiswa",
    "student_email",
    "email_student"
  ]);

  return {
    id:
      pickString(record, ["id"]) ||
      buildCacheKey([name, nim, university, major]) ||
      crypto.randomUUID(),
    name: titleCase(name),
    nim,
    university,
    universityShort: universityShort.toLowerCase(),
    major: titleCase(major),
    status,
    entryYear,
    ...(email ? { email } : {}),
    raw: record
  };
}

function normalizePayload(payload: unknown) {
  const arrayPayload = Array.isArray(payload)
    ? payload
    : typeof payload === "object" && payload !== null
      ? ((payload as { data?: unknown[]; results?: unknown[] }).data ??
        (payload as { data?: unknown[]; results?: unknown[] }).results ??
        [])
      : [];

  return arrayPayload
    .filter((item): item is RawRecord => typeof item === "object" && item !== null)
    .map(normalizeAlumniRecord);
}

function filterMockRecords(query: string) {
  const normalizedQuery = normalizeText(query);

  return mockAlumniPayload.filter((record) => {
    const haystack = normalizeText(
      [
        pickString(record, ["nama", "nama_lengkap", "full_name", "name"]),
        pickString(record, ["nim", "nomor_induk", "student_id"]),
        pickString(record, ["nama_pt", "pt", "university"]),
        pickString(record, ["nama_prodi", "prodi", "major"])
      ].join(" ")
    );

    return haystack.includes(normalizedQuery);
  });
}

async function fetchJson<T>(
  url: string,
  fetchImpl: typeof fetch,
  headers: Headers
): Promise<T> {
  const response = await fetchImpl(url, {
    method: "GET",
    headers,
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`Upstream request failed with status ${response.status}.`);
  }

  return (await response.json()) as T;
}

function normalizePddiktiRecord(
  summary: PddiktiSearchItem,
  detail?: PddiktiStudentDetail
) {
  return normalizeAlumniRecord({
    ...summary,
    ...detail,
    id: detail?.id ?? summary.id,
    nama: detail?.nama ?? summary.nama,
    nim: detail?.nim ?? summary.nim,
    nama_pt: detail?.nama_pt ?? summary.nama_pt,
    nama_prodi: detail?.prodi ?? summary.nama_prodi,
    sinkatan_pt: summary.sinkatan_pt
  });
}

async function fetchPddiktiRecords(
  query: string,
  baseUrl: string,
  fetchImpl: typeof fetch,
  headers: Headers
) {
  const searchUrl = `${baseUrl.replace(/\/$/, "")}/search/mhs/${encodeURIComponent(query)}/`;
  const searchResults = await fetchJson<PddiktiSearchItem[]>(searchUrl, fetchImpl, headers);
  const candidates = searchResults.slice(0, 20);

  const detailResults = await Promise.allSettled(
    candidates.map(async (item) => {
      if (!item.id) {
        return normalizePddiktiRecord(item);
      }

      const detailUrl = `${baseUrl.replace(/\/$/, "")}/mhs/detail/${encodeURIComponent(item.id)}/`;

      try {
        const detail = await fetchJson<PddiktiStudentDetail>(detailUrl, fetchImpl, headers);
        return normalizePddiktiRecord(item, detail);
      } catch {
        return normalizePddiktiRecord(item);
      }
    })
  );

  return detailResults.flatMap((result) =>
    result.status === "fulfilled" ? [result.value] : []
  );
}

async function fetchLiveRecords(query: string, options: SearchServiceOptions) {
  const runtimeEnv = getRuntimeEnv();
  const fetchImpl = options.fetchImpl ?? fetch;
  const upstreamUrls = [
    options.upstreamUrl ?? runtimeEnv.upstreamUrl,
    ...(options.upstreamFallbackUrls ?? runtimeEnv.upstreamFallbackUrls)
  ].filter(Boolean) as string[];

  const headers = new Headers({
    Accept: "application/json",
    "User-Agent": "Mozilla/5.0 AlmaTrace/1.0",
    ...(options.upstreamHeaders ?? runtimeEnv.upstreamHeaders)
  });

  const token = options.upstreamToken ?? runtimeEnv.upstreamToken;
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  if (upstreamUrls.length === 0) {
    throw new Error("No upstream PDDIKTI endpoint is configured.");
  }

  let lastError: Error | null = null;

  for (const upstreamUrl of upstreamUrls) {
    try {
      const records = await fetchPddiktiRecords(query, upstreamUrl, fetchImpl, headers);
      return {
        provider: new URL(upstreamUrl).host,
        records
      };
    } catch (error) {
      lastError =
        error instanceof Error ? error : new Error("Unknown upstream request error.");
    }
  }

  throw lastError ?? new Error("Unable to reach any upstream PDDIKTI endpoint.");
}

export async function searchAlumni(
  query: string,
  options: SearchServiceOptions = {}
): Promise<SearchApiResponse> {
  const trimmedQuery = normalizeWhitespace(query);
  const cacheKey = buildSearchCacheKey(trimmedQuery);
  const cacheResult = await getServerCache<SearchApiResponse>(
    "search",
    cacheKey,
    options.cacheFilePath
  );

  if (cacheResult.hit && cacheResult.entry) {
    return {
      ...cacheResult.entry.value,
      source: "cache",
      cached: true
    };
  }

  const runtimeEnv = getRuntimeEnv();
  const dataMode = options.dataMode ?? runtimeEnv.dataMode;
  const liveResult =
    dataMode === "live" ? await fetchLiveRecords(trimmedQuery, options) : null;
  const records =
    dataMode === "live"
      ? liveResult?.records ?? []
      : normalizePayload(filterMockRecords(trimmedQuery));

  const response: SearchApiResponse = {
    source: dataMode,
    ...(liveResult?.provider ? { provider: liveResult.provider } : {}),
    cached: false,
    records,
    fetchedAt: new Date().toISOString()
  };

  await setServerCache(
    "search",
    cacheKey,
    response,
    SERVER_CACHE_TTL_MS,
    trimmedQuery,
    options.cacheFilePath
  );

  return response;
}
