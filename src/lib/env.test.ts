import { getRuntimeEnv } from "@/lib/env";

describe("env", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("supports GOOGLE_CSE_KEY and GOOGLE_CSE_CX aliases", () => {
    delete process.env.GOOGLE_CSE_API_KEY;
    delete process.env.GOOGLE_CSE_ENGINE_ID;
    process.env.GOOGLE_CSE_KEY = "alias-key";
    process.env.GOOGLE_CSE_CX = "alias-cx";

    const runtimeEnv = getRuntimeEnv();

    expect(runtimeEnv.googleCseApiKey).toBe("alias-key");
    expect(runtimeEnv.googleCseEngineId).toBe("alias-cx");
  });

  it("supports SearXNG base URL aliases and list parsing", () => {
    delete process.env.SEARXNG_BASE_URLS;
    process.env.SEARXNG_BASE_URL =
      "https://search.one.example; https://search.two.example";

    const runtimeEnv = getRuntimeEnv();

    expect(runtimeEnv.searxngBaseUrls).toEqual([
      "https://search.one.example",
      "https://search.two.example"
    ]);
    expect(runtimeEnv.searxSpaceInstancesUrl).toBe(
      "https://searx.space/data/instances.json"
    );
  });

  it("uses platform-aware Playwright defaults when env is not overridden", () => {
    delete process.env.LOCAL_BROWSER_HEADLESS;
    delete process.env.PLAYWRIGHT_BROWSER_CHANNEL;

    const runtimeEnv = getRuntimeEnv();

    expect(runtimeEnv.localBrowserHeadless).toBe(process.platform !== "darwin");
    expect(runtimeEnv.playwrightBrowserChannel).toBe(
      process.platform === "darwin" ? "chrome" : "chromium"
    );
  });

  it("reads Brave, local Playwright, and legacy browserless runtime config", () => {
    process.env.BRAVE_SEARCH_API_KEY = "brave-key";
    process.env.LOCAL_BROWSER_MAX_WORKERS = "4";
    process.env.LOCAL_BROWSER_IDLE_MS = "7000";
    process.env.LOCAL_BROWSER_HEADLESS = "true";
    process.env.LOCAL_BROWSER_PROFILE_BASE_DIR = "/tmp/almatrace-workers";
    process.env.PLAYWRIGHT_BROWSER_CHANNEL = "chromium";
    process.env.PLAYWRIGHT_LAUNCH_TIMEOUT_MS = "11000";
    process.env.BROWSERLESS_WS_ENDPOINT = "ws://browserless:3000";
    process.env.BROWSERLESS_TOKEN = "browserless-token";
    process.env.BROWSERLESS_TIMEOUT_MS = "9000";
    process.env.ENRICHMENT_SEARCH_MAX_CANDIDATES = "7";

    const runtimeEnv = getRuntimeEnv();

    expect(runtimeEnv.braveSearchApiKey).toBe("brave-key");
    expect(runtimeEnv.localBrowserMaxWorkers).toBe(4);
    expect(runtimeEnv.localBrowserIdleMs).toBe(7000);
    expect(runtimeEnv.localBrowserHeadless).toBe(true);
    expect(runtimeEnv.localBrowserProfileBaseDir).toBe("/tmp/almatrace-workers");
    expect(runtimeEnv.playwrightBrowserChannel).toBe("chromium");
    expect(runtimeEnv.playwrightLaunchTimeoutMs).toBe(11000);
    expect(runtimeEnv.browserlessWsEndpoint).toBe("ws://browserless:3000");
    expect(runtimeEnv.browserlessToken).toBe("browserless-token");
    expect(runtimeEnv.browserlessTimeoutMs).toBe(9000);
    expect(runtimeEnv.enrichmentSearchMaxCandidates).toBe(7);
  });
});
