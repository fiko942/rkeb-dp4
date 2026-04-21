import { NextRequest } from "next/server";

import { POST } from "@/app/api/enrichment/route";
import { AUTH_COOKIE_NAME, createUnlockToken } from "@/lib/auth";
import { enrichPerson } from "@/lib/enrichment-service";

vi.mock("@/lib/enrichment-service", () => ({
  enrichPerson: vi.fn()
}));

describe("POST /api/enrichment", () => {
  it("returns 401 when the request is still locked", async () => {
    const response = await POST(
      new NextRequest("http://localhost/api/enrichment", {
        method: "POST",
        body: JSON.stringify({
          personId: "student-1",
          fullName: "Alya Rahman",
          cacheKey: "student-1"
        })
      })
    );

    expect(response.status).toBe(401);
  });

  it("returns 400 for incomplete payloads", async () => {
    const unlockToken = await createUnlockToken();
    const response = await POST(
      new NextRequest("http://localhost/api/enrichment", {
        method: "POST",
        headers: {
          cookie: `${AUTH_COOKIE_NAME}=${unlockToken}`
        },
        body: JSON.stringify({ fullName: "Alya Rahman" })
      })
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Payload enrichment tidak lengkap."
    });
  });

  it("returns enrichment results for valid payloads", async () => {
    const unlockToken = await createUnlockToken();
    vi.mocked(enrichPerson).mockResolvedValue({
      source: "live",
      email: {
        value: "alya@students.itb.ac.id",
        source: "github-public-profile",
        verifiedBy: "university, major"
      },
      address: {
        label: "Lokasi profesional",
        value: "Bandung, Indonesia",
        source: "github-public-profile",
        verifiedBy: "university, major"
      },
      profiles: [
        {
          platform: "github",
          username: "alyarahman",
          url: "https://github.com/alyarahman",
          source: "github-public-profile",
          confidence: 0.94
        }
      ],
      warnings: []
    });

    const response = await POST(
      new NextRequest("http://localhost/api/enrichment", {
        method: "POST",
        headers: {
          cookie: `${AUTH_COOKIE_NAME}=${unlockToken}`
        },
        body: JSON.stringify({
          personId: "student-1",
          fullName: "Alya Rahman",
          cacheKey: "student-1"
        })
      })
    );

    expect(response.status).toBe(200);
    expect(enrichPerson).toHaveBeenCalledWith({
      personId: "student-1",
      fullName: "Alya Rahman",
      cacheKey: "student-1"
    });
    expect(await response.json()).toEqual(
      expect.objectContaining({
        address: expect.objectContaining({
          value: "Bandung, Indonesia"
        }),
        profiles: expect.arrayContaining([
          expect.objectContaining({
            username: "alyarahman"
          })
        ])
      })
    );
  });
});
