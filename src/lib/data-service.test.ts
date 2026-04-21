import { mkdtemp } from "fs/promises";
import os from "os";
import path from "path";

import { normalizeAlumniRecord, searchAlumni } from "@/lib/data-service";

describe("data-service", () => {
  it("normalizes inconsistent payloads and keeps actual email only", () => {
    const normalized = normalizeAlumniRecord({
      nama_lengkap: "citra maheswari",
      nomor_induk: "18004551",
      pt: "Universitas Gadjah Mada",
      pt_singkat: "UGM",
      prodi: "ilmu komputer",
      status_kuliah: "Lulus",
      tahun_masuk: "2018",
      email_mahasiswa: "citra.maheswari@mail.ugm.ac.id"
    });

    expect(normalized).toMatchObject({
      name: "Citra Maheswari",
      nim: "18004551",
      university: "Universitas Gadjah Mada",
      universityShort: "ugm",
      major: "Ilmu Komputer",
      status: "Lulus",
      entryYear: "2018",
      email: "citra.maheswari@mail.ugm.ac.id"
    });
  });

  it("maps PDDIKTI public API fields and derives the entry year from tanggal_masuk", () => {
    const normalized = normalizeAlumniRecord({
      nama: "DINA YUANDRA DITA",
      nim: "1706018630",
      nama_pt: "UNIVERSITAS INDONESIA",
      sinkatan_pt: "UI",
      prodi: "AKUNTANSI",
      status_saat_ini: "Lulus-2020/2021 Ganjil",
      tanggal_masuk: "2017-05-16"
    });

    expect(normalized).toMatchObject({
      name: "Dina Yuandra Dita",
      university: "UNIVERSITAS INDONESIA",
      universityShort: "ui",
      major: "Akuntansi",
      status: "Lulus-2020/2021 Ganjil",
      entryYear: "2017"
    });
  });

  it("uses the server cache on repeated searches", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "almatrace-search-"));
    const cacheFilePath = path.join(tempDir, "cache.json");

    const first = await searchAlumni("Alya", {
      dataMode: "mock",
      cacheFilePath
    });
    const second = await searchAlumni("Alya", {
      dataMode: "mock",
      cacheFilePath
    });

    expect(first.source).toBe("mock");
    expect(first.cached).toBe(false);
    expect(first.records[0]?.name).toBe("Alya Rahman");

    expect(second.source).toBe("cache");
    expect(second.cached).toBe(true);
    expect(second.records).toHaveLength(first.records.length);
  });

  it("fetches real PDDIKTI search results and merges detail responses", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "almatrace-search-live-"));
    const cacheFilePath = path.join(tempDir, "cache.json");
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              id: "student-id",
              nama: "DINA YUANDRA DITA",
              nim: "1706018630",
              nama_pt: "UNIVERSITAS INDONESIA",
              sinkatan_pt: "UI",
              nama_prodi: "AKUNTANSI"
            }
          ]),
          {
            status: 200,
            headers: {
              "content-type": "application/json"
            }
          }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "student-id",
            nama: "Dina Yuandra Dita",
            nim: "1706018630",
            nama_pt: "Universitas Indonesia",
            prodi: "Akuntansi",
            status_saat_ini: "Lulus-2020/2021 Ganjil",
            tanggal_masuk: "2017-05-16"
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json"
            }
          }
        )
      );

    const response = await searchAlumni("dita", {
      dataMode: "live",
      cacheFilePath,
      fetchImpl: fetchMock,
      upstreamUrl: "https://pddikti.fastapicloud.dev/api"
    });

    expect(response.source).toBe("live");
    expect(response.provider).toBe("pddikti.fastapicloud.dev");
    expect(response.records).toEqual([
      expect.objectContaining({
        name: "Dina Yuandra Dita",
        university: "Universitas Indonesia",
        universityShort: "ui",
        major: "Akuntansi",
        status: "Lulus-2020/2021 Ganjil",
        entryYear: "2017"
      })
    ]);
  });
});
