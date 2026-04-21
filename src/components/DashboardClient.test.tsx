import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { DashboardClient } from "@/components/DashboardClient";

describe("DashboardClient", () => {
  it("debounces search requests before hitting the API", async () => {
    const fetchMock = vi.spyOn(global, "fetch").mockImplementation((input) => {
      const url = String(input);

      if (url === "/api/cache") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              summaries: [],
              updatedAt: "2026-04-21T00:00:00.000Z"
            }),
            {
              status: 200,
              headers: {
                "content-type": "application/json"
              }
            }
          )
        );
      }

      if (url.startsWith("/api/alumni/search?q=Alya")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              source: "mock",
              cached: false,
              fetchedAt: "2026-04-21T00:00:00.000Z",
              records: [
                {
                  id: "student-1",
                  name: "Alya Rahman",
                  nim: "2110112001",
                  university: "Institut Teknologi Bandung",
                  universityShort: "itb",
                  major: "Teknik Informatika",
                  status: "Lulus",
                  entryYear: "2021"
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
      }

      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });

    render(<DashboardClient />);
    fireEvent.change(screen.getByLabelText("Cari alumni"), {
      target: {
        value: "Alya"
      }
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 220));
    });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    await waitFor(() => {
      expect(screen.getByText("Alya Rahman")).toBeInTheDocument();
    });
  });
});
