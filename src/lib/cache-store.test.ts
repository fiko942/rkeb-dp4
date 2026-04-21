import { mkdtemp, writeFile } from "fs/promises";
import os from "os";
import path from "path";

import { readCacheStore } from "@/lib/cache-store";

describe("cache-store", () => {
  it("recovers from a corrupt cache file", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "almatrace-cache-"));
    const cacheFilePath = path.join(tempDir, "cache.json");

    await writeFile(cacheFilePath, "{invalid-json", "utf8");

    const store = await readCacheStore(cacheFilePath);

    expect(store).toEqual({
      search: {},
      discovery: {},
      enrichment: {}
    });
  });
});
