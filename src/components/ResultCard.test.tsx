import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ResultCard } from "@/components/ResultCard";
import type { NormalizedAlumniRecord } from "@/lib/types";

const record: NormalizedAlumniRecord = {
  id: "student-1",
  name: "Alya Rahman",
  nim: "2110112001",
  university: "Institut Teknologi Bandung",
  universityShort: "itb",
  major: "Teknik Informatika",
  status: "Lulus",
  entryYear: "2021"
};

describe("ResultCard", () => {
  it("keeps contact and social details hidden by default", () => {
    render(<ResultCard record={record} />);

    expect(screen.queryByText("Kontak & Profil")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Cari Kontak & Profil/i })
    ).toBeInTheDocument();
  });

  it("loads enrichment only after manual click and renders direct matches", async () => {
    const user = userEvent.setup();
    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
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
              confidence: 0.95
            },
            {
              platform: "whatsapp",
              username: "628123456789",
              url: "https://wa.me/628123456789",
              source: "portfolio-contact",
              confidence: 0.91
            }
          ],
          warnings: [],
          meta: {
            providers: [
              { name: "playwright-search", source: "live" },
              { name: "playwright-local", source: "live" }
            ],
            discoveryCache: "miss",
            browserFollowupMs: 820,
            browserVisitedCount: 1
          },
          trace: [
            {
              url: "https://github.com/alyarahman",
              stage: "browser",
              source: "github-public-profile",
              status: "accepted",
              detail: "confidence 0.95 · signals university, major"
            }
          ]
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }
      )
    );

    render(<ResultCard record={record} />);
    await user.click(screen.getByRole("button", { name: /Cari Kontak & Profil/i }));

    expect(await screen.findByText("Kontak & Profil")).toBeInTheDocument();
    expect(await screen.findByText("alya@students.itb.ac.id")).toBeInTheDocument();
    expect(await screen.findByText("Bandung, Indonesia")).toBeInTheDocument();
    expect(await screen.findByText("@alyarahman")).toBeInTheDocument();
    expect(await screen.findByText("628123456789")).toBeInTheDocument();
    expect(await screen.findByText("1 halaman dibuka")).toBeInTheDocument();
    expect(await screen.findByText("github.com/alyarahman")).toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("omits empty platforms and email when enrichment finds nothing", async () => {
    const user = userEvent.setup();
    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          source: "live",
          profiles: [],
          warnings: []
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }
      )
    );

    render(<ResultCard record={record} />);
    await user.click(screen.getByRole("button", { name: /Cari Kontak & Profil/i }));

    expect(await screen.findByText("Tidak ditemukan.")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByText(/@alyarahman/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/students.itb.ac.id/i)).not.toBeInTheDocument();
    });
  });
});
