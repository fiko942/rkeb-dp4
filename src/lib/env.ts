import type { DataMode } from "@/lib/types";
import { safeJsonParse } from "@/lib/utils";

function readDataMode(): DataMode {
  return process.env.ALMATRACE_DATA_MODE === "mock" ? "mock" : "live";
}

function readHeaders() {
  return safeJsonParse<Record<string, string>>(
    process.env.ALMATRACE_UPSTREAM_HEADERS ?? "{}",
    {}
  );
}

function readFallbackUrls() {
  const raw = process.env.ALMATRACE_UPSTREAM_FALLBACK_URLS;
  if (!raw) {
    return ["https://pddikti.rone.dev/api"];
  }

  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function readUrlList(...values: Array<string | undefined>) {
  return values
    .flatMap((value) => value?.split(/[,\n;]+/) ?? [])
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function readOptionalBoolean(value: string | undefined) {
  if (value === undefined) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized === "auto") {
    return undefined;
  }

  return !["0", "false", "no", "off"].includes(normalized);
}

function getDefaultLocalBrowserHeadless() {
  return process.platform !== "darwin";
}

function getDefaultPlaywrightChannel() {
  return process.platform === "darwin" ? "chrome" : "chromium";
}

export function getRuntimeEnv() {
  return {
    dataMode: readDataMode(),
    upstreamUrl:
      process.env.ALMATRACE_UPSTREAM_URL ?? "https://pddikti.fastapicloud.dev/api",
    upstreamFallbackUrls: readFallbackUrls(),
    upstreamToken: process.env.ALMATRACE_UPSTREAM_TOKEN,
    upstreamHeaders: readHeaders(),
    upstreamQueryParam: process.env.ALMATRACE_UPSTREAM_QUERY_PARAM ?? "q",
    braveSearchApiKey: process.env.BRAVE_SEARCH_API_KEY,
    localBrowserMaxWorkers: Number(process.env.LOCAL_BROWSER_MAX_WORKERS ?? "2"),
    localBrowserIdleMs: Number(process.env.LOCAL_BROWSER_IDLE_MS ?? "5000"),
    localBrowserHeadless:
      readOptionalBoolean(process.env.LOCAL_BROWSER_HEADLESS) ??
      getDefaultLocalBrowserHeadless(),
    localBrowserProfileBaseDir: process.env.LOCAL_BROWSER_PROFILE_BASE_DIR,
    playwrightBrowserChannel:
      process.env.PLAYWRIGHT_BROWSER_CHANNEL ?? getDefaultPlaywrightChannel(),
    playwrightExecutablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH,
    playwrightLaunchTimeoutMs: Number(
      process.env.PLAYWRIGHT_LAUNCH_TIMEOUT_MS ?? "15000"
    ),
    browserlessWsEndpoint: process.env.BROWSERLESS_WS_ENDPOINT,
    browserlessToken: process.env.BROWSERLESS_TOKEN,
    browserlessTimeoutMs: Number(process.env.BROWSERLESS_TIMEOUT_MS ?? "12000"),
    enrichmentSearchMaxCandidates: Number(
      process.env.ENRICHMENT_SEARCH_MAX_CANDIDATES ?? "5"
    ),
    searxngBaseUrls: readUrlList(
      process.env.SEARXNG_BASE_URLS,
      process.env.SEARXNG_BASE_URL
    ),
    searxSpaceInstancesUrl:
      process.env.SEARX_SPACE_INSTANCES_URL ??
      "https://searx.space/data/instances.json",
    googleCseApiKey:
      process.env.GOOGLE_CSE_API_KEY ?? process.env.GOOGLE_CSE_KEY,
    googleCseEngineId:
      process.env.GOOGLE_CSE_ENGINE_ID ?? process.env.GOOGLE_CSE_CX
  };
}
