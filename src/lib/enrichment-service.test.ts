import { mkdtemp } from "fs/promises";
import os from "os";
import path from "path";

import {
  enrichPerson,
  isDirectProfileUrl,
  scoreCandidate,
  type PageResolver,
  type SearchProvider
} from "@/lib/enrichment-service";
import type { EnrichmentRequestPayload, EnrichmentProviderMeta } from "@/lib/types";

const payload: EnrichmentRequestPayload = {
  personId: "student-1",
  fullName: "Alya Rahman",
  university: "Institut Teknologi Bandung",
  universityShort: "itb",
  major: "Teknik Informatika",
  status: "Lulus",
  entryYear: "2021",
  cacheKey: "student-1:2110112001"
};

class FakeSearchProvider implements SearchProvider {
  constructor(
    public readonly name: string,
    private readonly result: {
      items: Array<{
        link: string;
        title?: string;
        snippet?: string;
        source: string;
        platformHint?: "github" | "linkedin" | "instagram" | "x" | "whatsapp" | "website";
      }>;
      warnings: string[];
      meta: EnrichmentProviderMeta;
    }
  ) {}

  searchCandidates = vi.fn(async () => this.result);
}

class FakePageResolver implements PageResolver {
  public resolveCalls: string[] = [];

  constructor(
    public readonly name: string,
    private readonly available: boolean,
    private readonly metadataByUrl: Record<
      string,
      {
        title: string;
        description: string;
        jsonLdText: string;
        visibleText: string;
        emails: string[];
        addresses: string[];
        directProfileLinks: string[];
        crawlableLinks: string[];
        probableName: string;
      } | null
    > = {}
  ) {}

  isAvailable() {
    return this.available;
  }

  resolve = vi.fn(async (url: string) => {
    this.resolveCalls.push(url);
    return this.metadataByUrl[url] ?? null;
  });

  close = vi.fn(async () => undefined);
}

describe("enrichment-service", () => {
  it("accepts exact-name candidates with corroborating signals", () => {
    const decision = scoreCandidate(payload, {
      platform: "github",
      url: "https://github.com/alyarahman",
      username: "alyarahman",
      displayName: "Alya Rahman",
      summaryText: "Teknik Informatika at Institut Teknologi Bandung",
      emails: ["alya@students.itb.ac.id"],
      addresses: [],
      source: "playwright-search:github"
    });

    expect(decision.accepted).toBe(true);
    expect(decision.signals).toEqual(
      expect.arrayContaining(["university", "major"])
    );
  });

  it("rejects name-only matches for common identities", () => {
    const decision = scoreCandidate(
      {
        ...payload,
        fullName: "Budi Santoso",
        cacheKey: "student-2"
      },
      {
        platform: "github",
        url: "https://github.com/budisantoso",
        username: "budisantoso",
        displayName: "Budi Santoso",
        summaryText: "Frontend engineer in Jakarta",
        emails: [],
        addresses: [],
        source: "playwright-search:github"
      }
    );

    expect(decision.accepted).toBe(false);
  });

  it("rejects search and discovery URLs", () => {
    expect(
      isDirectProfileUrl(
        "https://www.linkedin.com/search/results/people/?keywords=Alya%20Rahman"
      )
    ).toBe(false);
    expect(isDirectProfileUrl("https://github.com/alyarahman")).toBe(true);
    expect(isDirectProfileUrl("https://wa.me/628123456789")).toBe(true);
  });

  it("resolves browser-only direct profile matches", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "almatrace-enrich-"));
    const cacheFilePath = path.join(tempDir, "cache.json");
    const provider = new FakeSearchProvider("playwright-search", {
      items: [
        {
          link: "https://github.com/alyarahman",
          title: "Alya Rahman - GitHub",
          snippet: "Teknik Informatika at Institut Teknologi Bandung",
          source: "playwright-search:github",
          platformHint: "github"
        }
      ],
      warnings: [],
      meta: {
        name: "playwright-search",
        source: "live"
      }
    });
    const pageResolver = new FakePageResolver("playwright-local", true, {
      "https://github.com/alyarahman": {
        title: "Alya Rahman",
        description: "Teknik Informatika at Institut Teknologi Bandung",
        jsonLdText: "",
        visibleText: "Alya Rahman Bandung, Indonesia alya@students.itb.ac.id",
        emails: ["alya@students.itb.ac.id"],
        addresses: ["Bandung, Indonesia"],
        directProfileLinks: [],
        crawlableLinks: [],
        probableName: "Alya Rahman"
      }
    });

    const response = await enrichPerson(payload, {
      cacheFilePath,
      searchProviders: [provider],
      pageResolver
    });

    expect(response.source).toBe("live");
    expect(response.email?.value).toBe("alya@students.itb.ac.id");
    expect(response.address?.value).toBe("Bandung, Indonesia");
    expect(response.profiles).toEqual([
      expect.objectContaining({
        platform: "github",
        username: "alyarahman",
        url: "https://github.com/alyarahman"
      })
    ]);
    expect(response.warnings).toEqual([]);
    expect(response.meta?.providers).toEqual([
      { name: "playwright-search", source: "live" },
      { name: "playwright-local", source: "live" }
    ]);
    expect(response.meta?.browserVisitedCount).toBe(1);
    expect(response.trace).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stage: "browser",
          status: "opened",
          url: "https://github.com/alyarahman"
        })
      ])
    );
  });

  it("uses injected browser-search candidates plus follow-up for public contacts", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "almatrace-enrich-"));
    const cacheFilePath = path.join(tempDir, "cache.json");
    const provider = new FakeSearchProvider("playwright-search", {
      items: [
        {
          link: "https://www.linkedin.com/in/alyarahman",
          title: "Alya Rahman - LinkedIn",
          snippet: "Teknik Informatika at Institut Teknologi Bandung",
          source: "playwright-search:linkedin",
          platformHint: "linkedin"
        },
        {
          link: "https://alya.dev",
          title: "Alya Rahman",
          snippet: "Portfolio Teknik Informatika ITB",
          source: "playwright-search:website",
          platformHint: "website"
        }
      ],
      warnings: [],
      meta: {
        name: "playwright-search",
        source: "live"
      }
    });
    const pageResolver = new FakePageResolver("playwright-local", true, {
      "https://alya.dev": {
        title: "Alya Rahman",
        description: "Teknik Informatika at Institut Teknologi Bandung",
        jsonLdText: "",
        visibleText: "Alya Rahman Bandung, Indonesia",
        emails: ["alya@alumni.itb.ac.id"],
        addresses: ["Bandung, Indonesia"],
        directProfileLinks: ["https://x.com/alyarahman"],
        crawlableLinks: [],
        probableName: "Alya Rahman"
      },
      "https://www.linkedin.com/in/alyarahman": {
        title: "Alya Rahman - LinkedIn",
        description: "Teknik Informatika at Institut Teknologi Bandung",
        jsonLdText: "",
        visibleText: "Alya Rahman LinkedIn Institut Teknologi Bandung",
        emails: [],
        addresses: [],
        directProfileLinks: [],
        crawlableLinks: [],
        probableName: "Alya Rahman"
      }
    });

    const response = await enrichPerson(
      {
        ...payload,
        cacheKey: "student-1:playwright-browser"
      },
      {
        cacheFilePath,
        searchProviders: [provider],
        pageResolver
      }
    );

    expect(provider.searchCandidates).toHaveBeenCalledTimes(1);
    expect(pageResolver.resolveCalls).toEqual(
      expect.arrayContaining([
        "https://alya.dev",
        "https://www.linkedin.com/in/alyarahman"
      ])
    );
    expect(response.email?.value).toBe("alya@alumni.itb.ac.id");
    expect(response.address?.value).toBe("Bandung, Indonesia");
    expect(response.profiles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          platform: "linkedin",
          username: "alyarahman",
          url: "https://www.linkedin.com/in/alyarahman"
        }),
        expect.objectContaining({
          platform: "x",
          username: "alyarahman",
          url: "https://x.com/alyarahman"
        })
      ])
    );
    expect(response.meta?.discoveryCache).toBe("miss");
    expect(response.meta?.browserVisitedCount).toBe(2);
    expect(response.meta?.providers).toEqual(
      expect.arrayContaining([
        { name: "playwright-search", source: "live" },
        { name: "playwright-local", source: "live" }
      ])
    );
    expect(response.trace).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stage: "browser",
          status: "opened",
          url: "https://alya.dev"
        }),
        expect.objectContaining({
          status: "accepted",
          url: "https://www.linkedin.com/in/alyarahman"
        })
      ])
    );
  });

  it("surfaces compact cooldown warnings and skips browser follow-up cleanly", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "almatrace-enrich-"));
    const cacheFilePath = path.join(tempDir, "cache.json");
    const provider = new FakeSearchProvider("playwright-search", {
      items: [],
      warnings: ["Pencarian browser sedang terkena challenge atau rate limit dari mesin pencari."],
      meta: {
        name: "playwright-search",
        source: "cooldown"
      }
    });
    const pageResolver = new FakePageResolver("playwright-local", false);

    const response = await enrichPerson(
      {
        ...payload,
        cacheKey: "student-1:playwright-cooldown"
      },
      {
        cacheFilePath,
        searchProviders: [provider],
        pageResolver
      }
    );

    expect(response.profiles).toEqual([]);
    expect(response.email).toBeUndefined();
    expect(response.warnings).toEqual([
      "Pencarian browser sedang terkena challenge atau rate limit dari mesin pencari."
    ]);
    expect(response.meta?.discoveryCache).toBe("skipped");
  });

  it("keeps browser provider live when no candidate URL is opened", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "almatrace-enrich-"));
    const cacheFilePath = path.join(tempDir, "cache.json");
    const provider = new FakeSearchProvider("playwright-search", {
      items: [],
      warnings: [],
      meta: {
        name: "playwright-search",
        source: "live"
      }
    });
    const pageResolver = new FakePageResolver("playwright-local", true);

    const response = await enrichPerson(
      {
        ...payload,
        cacheKey: "student-1:no-candidates"
      },
      {
        cacheFilePath,
        searchProviders: [provider],
        pageResolver
      }
    );

    expect(response.meta?.providers).toEqual([
      { name: "playwright-search", source: "live" },
      { name: "playwright-local", source: "live" }
    ]);
    expect(response.meta?.browserVisitedCount).toBe(0);
  });

  it("filters residential addresses and reuses accepted enrichment cache", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "almatrace-enrich-"));
    const cacheFilePath = path.join(tempDir, "cache.json");
    const provider = new FakeSearchProvider("playwright-search", {
      items: [
        {
          link: "https://alya.dev",
          title: "Alya Rahman",
          snippet: "Portfolio Teknik Informatika ITB",
          source: "playwright-search:website",
          platformHint: "website"
        }
      ],
      warnings: [],
      meta: {
        name: "playwright-search",
        source: "live"
      }
    });
    const pageResolver = new FakePageResolver("playwright-local", true, {
      "https://alya.dev": {
        title: "Alya Rahman",
        description: "Teknik Informatika at Institut Teknologi Bandung",
        jsonLdText: "",
        visibleText: "Alya Rahman",
        emails: ["alya@alumni.itb.ac.id"],
        addresses: ["Perumahan Melati Blok A RT 01 RW 02"],
        directProfileLinks: [],
        crawlableLinks: [],
        probableName: "Alya Rahman"
      }
    });

    const firstResponse = await enrichPerson(
      {
        ...payload,
        cacheKey: "student-1:cache-hit"
      },
      {
        cacheFilePath,
        searchProviders: [provider],
        pageResolver
      }
    );

    expect(firstResponse.address).toBeUndefined();

    const cachedProvider = new FakeSearchProvider("playwright-search", {
      items: [],
      warnings: [],
      meta: {
        name: "playwright-search",
        source: "live"
      }
    });
    const cachedResolver = new FakePageResolver("playwright-local", true);

    const cachedResponse = await enrichPerson(
      {
        ...payload,
        cacheKey: "student-1:cache-hit"
      },
      {
        cacheFilePath,
        searchProviders: [cachedProvider],
        pageResolver: cachedResolver
      }
    );

    expect(cachedResponse.source).toBe("cache");
    expect(cachedProvider.searchCandidates).not.toHaveBeenCalled();
    expect(cachedResolver.resolve).not.toHaveBeenCalled();
  });
});
