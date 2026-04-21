import { NextRequest } from "next/server";

import { GET } from "@/app/api/alumni/search/route";
import { AUTH_COOKIE_NAME, createUnlockToken } from "@/lib/auth";
import { searchAlumni } from "@/lib/data-service";

vi.mock("@/lib/data-service", () => ({
  searchAlumni: vi.fn()
}));

describe("GET /api/alumni/search", () => {
  it("returns 401 when the request is still locked", async () => {
    const response = await GET(
      new NextRequest("http://localhost/api/alumni/search?q=Alya")
    );

    expect(response.status).toBe(401);
  });

  it("returns 400 for short queries", async () => {
    const unlockToken = await createUnlockToken();
    const response = await GET(
      new NextRequest("http://localhost/api/alumni/search?q=a", {
        headers: {
          cookie: `${AUTH_COOKIE_NAME}=${unlockToken}`
        }
      })
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual(
      expect.objectContaining({
        error: "Query minimal 2 karakter."
      })
    );
  });

  it("returns service results for valid queries", async () => {
    const unlockToken = await createUnlockToken();
    vi.mocked(searchAlumni).mockResolvedValue({
      source: "mock",
      cached: false,
      fetchedAt: "2026-04-21T00:00:00.000Z",
      records: [
        {
          id: "1",
          name: "Alya Rahman",
          nim: "2110112001",
          university: "Institut Teknologi Bandung",
          universityShort: "itb",
          major: "Teknik Informatika",
          status: "Lulus",
          entryYear: "2021"
        }
      ]
    });

    const response = await GET(
      new NextRequest("http://localhost/api/alumni/search?q=Alya", {
        headers: {
          cookie: `${AUTH_COOKIE_NAME}=${unlockToken}`
        }
      })
    );

    expect(response.status).toBe(200);
    expect(searchAlumni).toHaveBeenCalledWith("Alya");
    expect(await response.json()).toEqual(
      expect.objectContaining({
        source: "mock",
        records: expect.arrayContaining([
          expect.objectContaining({
            name: "Alya Rahman"
          })
        ])
      })
    );
  });
});
