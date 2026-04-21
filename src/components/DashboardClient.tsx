"use client";

import { startTransition, useCallback, useDeferredValue, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Github, Globe, Search, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { CacheStatus } from "@/components/CacheStatus";
import { LogoutButton } from "@/components/LogoutButton";
import { ResultCard, ResultCardSkeleton } from "@/components/ResultCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fadeInUp, staggerContainer } from "@/lib/motion";
import { getClientSearchCache, setClientSearchCache } from "@/lib/client-cache";
import type { CacheStatusResponse, SearchApiResponse } from "@/lib/types";

export function DashboardClient() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [response, setResponse] = useState<SearchApiResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cacheStatus, setCacheStatus] = useState<CacheStatusResponse | null>(null);
  const [localCacheHit, setLocalCacheHit] = useState(false);

  const deferredQuery = useDeferredValue(query);
  const activeQuery = deferredQuery.trim();

  const loadCacheStatus = useCallback(async () => {
    try {
      const cacheResponse = await fetch("/api/cache", { cache: "no-store" });
      if (cacheResponse.status === 401) {
        router.push("/");
        router.refresh();
        return;
      }

      if (!cacheResponse.ok) {
        return;
      }

      setCacheStatus((await cacheResponse.json()) as CacheStatusResponse);
    } catch {
      // Ignore non-critical cache status errors.
    }
  }, [router]);

  useEffect(() => {
    void loadCacheStatus();
  }, [loadCacheStatus]);

  useEffect(() => {
    if (activeQuery.length < 2) {
      setResponse(null);
      setError(null);
      setIsLoading(false);
      setLocalCacheHit(false);
      return;
    }

    const timer = window.setTimeout(async () => {
      const localEntry = getClientSearchCache(activeQuery);
      if (localEntry) {
        setLocalCacheHit(true);
        startTransition(() => {
          setResponse({
            ...localEntry,
            cached: true,
            source: "cache"
          });
        });
        return;
      }

      setIsLoading(true);
      setError(null);
      setLocalCacheHit(false);

      try {
        const searchResponse = await fetch(
          `/api/alumni/search?q=${encodeURIComponent(activeQuery)}`,
          {
            method: "GET",
            cache: "no-store"
          }
        );

        if (searchResponse.status === 401) {
          toast.error("Sesi terkunci. Masukkan PIN lagi.");
          router.push("/");
          router.refresh();
          return;
        }

        if (!searchResponse.ok) {
          throw new Error("Pencarian gagal diproses.");
        }

        const payload = (await searchResponse.json()) as SearchApiResponse;
        startTransition(() => {
          setResponse(payload);
        });
        setClientSearchCache(activeQuery, payload);
        void loadCacheStatus();
      } catch (searchError) {
        const message =
          searchError instanceof Error
            ? searchError.message
            : "Terjadi error saat mencari alumni.";

        setError(message);
        toast.error(message);
      } finally {
        setIsLoading(false);
      }
    }, 350);

    return () => {
      window.clearTimeout(timer);
    };
  }, [activeQuery, loadCacheStatus, router]);

  const resultCount = response?.records.length ?? 0;
  const lastSource =
    localCacheHit ? "client-cache" : response?.provider ?? response?.source ?? "idle";

  return (
    <div className="relative overflow-hidden">
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[480px] bg-[radial-gradient(circle_at_top,rgba(27,156,252,0.28),transparent_45%),radial-gradient(circle_at_30%_30%,rgba(34,197,94,0.16),transparent_28%),radial-gradient(circle_at_85%_20%,rgba(244,114,182,0.18),transparent_24%)]" />

      <motion.section
        className="mx-auto max-w-7xl px-6 pb-14 pt-10 md:px-10 lg:px-12"
        initial="hidden"
        animate="visible"
        variants={staggerContainer}
      >
        <motion.div variants={fadeInUp} className="max-w-3xl">
          <div className="flex items-start justify-between gap-4">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs uppercase tracking-[0.2em] text-sky-100">
              <Sparkles className="h-3.5 w-3.5" />
              Alumni Tracing & Intelligence Dashboard
            </div>
            <LogoutButton />
          </div>
          <h1 className="mt-6 font-display text-5xl font-semibold tracking-[-0.03em] text-foreground md:text-6xl">
            AlmaTrace
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-muted-foreground">
            Cari alumni dari PDDIKTI public API dengan cache berlapis dan enrichment
            kontak yang hanya menampilkan hasil direct profile ber-confidence tinggi.
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
            <a
              className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 transition hover:border-white/20 hover:text-foreground"
              href="https://github.com/fiko942/rkeb-dp4"
              target="_blank"
              rel="noreferrer"
            >
              <Github className="h-4 w-4" />
              Repository open source
            </a>
            <a
              className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 transition hover:border-white/20 hover:text-foreground"
              href="https://rkeb-dp4.streampeg.com"
              target="_blank"
              rel="noreferrer"
            >
              <Globe className="h-4 w-4" />
              rkeb-dp4.streampeg.com
            </a>
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2">
              PIN demo 085213
            </div>
          </div>
        </motion.div>

        <motion.div variants={fadeInUp} className="mt-10 glass rounded-[32px] p-5 md:p-6">
          <div className="flex flex-col gap-4 md:flex-row">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                aria-label="Cari alumni"
                className="pl-11"
                placeholder="Cari nama, NIM, kampus, atau prodi..."
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            <Button
              variant="default"
              onClick={() => {
                setQuery((current) => current.trim());
              }}
            >
              Jalankan Query
            </Button>
          </div>
          <p className="mt-3 text-sm text-muted-foreground">
            Debounced 350ms. Gunakan minimal 2 karakter untuk mulai pencarian.
          </p>
        </motion.div>

        <div className="mt-6">
          <CacheStatus
            cacheStatus={cacheStatus}
            lastSource={lastSource}
            localCacheHit={localCacheHit}
          />
        </div>

        <motion.div variants={fadeInUp} className="mt-10 flex items-center justify-between">
          <div>
            <p className="text-sm uppercase tracking-[0.2em] text-muted-foreground">
              Search Results
            </p>
            <h2 className="mt-2 font-display text-2xl font-semibold text-foreground">
              {activeQuery.length < 2
                ? "Masukkan query untuk mulai"
                : `${resultCount} hasil ditemukan`}
            </h2>
          </div>
          {response ? (
            <div className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-muted-foreground">
              {localCacheHit
                ? "localStorage hit"
                : response.cached
                  ? "server cache hit"
                  : response.provider ?? response.source}
            </div>
          ) : null}
        </motion.div>

        {error ? (
          <motion.div
            variants={fadeInUp}
            className="mt-6 rounded-[28px] border border-rose-400/20 bg-rose-500/10 px-5 py-4 text-sm text-rose-100"
          >
            {error}
          </motion.div>
        ) : null}

        {isLoading ? (
          <div className="mt-8 grid gap-5 lg:grid-cols-2">
            <ResultCardSkeleton />
            <ResultCardSkeleton />
            <ResultCardSkeleton />
          </div>
        ) : response && response.records.length > 0 ? (
          <div className="mt-8 grid gap-5 lg:grid-cols-2">
            {response.records.map((record) => (
              <ResultCard key={record.id} record={record} />
            ))}
          </div>
        ) : activeQuery.length >= 2 ? (
          <motion.div
            variants={fadeInUp}
            className="mt-8 glass rounded-[32px] px-6 py-8 text-center"
          >
            <p className="text-lg font-medium text-foreground">Tidak ada hasil yang cocok.</p>
            <p className="mt-2 text-sm text-muted-foreground">
              Coba kata kunci lain atau gunakan kombinasi nama dan kampus.
            </p>
          </motion.div>
        ) : (
          <motion.div
            variants={fadeInUp}
            className="mt-8 glass rounded-[32px] px-6 py-8 text-center"
          >
            <p className="text-lg font-medium text-foreground">
              Alumni records akan muncul di sini.
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              AlmaTrace hanya mengambil detail kontak saat Anda memintanya pada kartu tertentu.
            </p>
          </motion.div>
        )}
      </motion.section>
    </div>
  );
}
