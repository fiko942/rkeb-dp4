"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  DatabaseZap,
  GraduationCap,
  LoaderCircle,
  Mail,
  MapPin,
  Search,
  ShieldCheck,
  Telescope,
  UserRoundCheck
} from "lucide-react";
import { toast } from "sonner";

import { springCard } from "@/lib/motion";
import type {
  ContactEmail,
  EnrichmentApiResponse,
  EnrichmentProviderMeta,
  EnrichmentRequestPayload,
  EnrichmentTraceItem,
  NormalizedAlumniRecord,
  PublicProfessionalAddress,
  SocialPlatform
} from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const iconMap: Record<SocialPlatform, string> = {
  github: "GitHub",
  linkedin: "LinkedIn",
  instagram: "Instagram",
  x: "X",
  whatsapp: "WhatsApp"
};

function profileHandleLabel(platform: SocialPlatform, username: string) {
  if (platform === "whatsapp") {
    return username.startsWith("+") ? username : username;
  }

  return `@${username}`;
}

interface ResultCardProps {
  record: NormalizedAlumniRecord;
}

function buildRequestPayload(record: NormalizedAlumniRecord): EnrichmentRequestPayload {
  return {
    personId: record.id,
    fullName: record.name,
    university: record.university,
    universityShort: record.universityShort,
    major: record.major,
    status: record.status,
    entryYear: record.entryYear,
    cacheKey: `${record.id}:${record.nim}`
  };
}

function renderEmailBadge(email?: ContactEmail | { value: string; source: string; verifiedBy: string }) {
  if (!email) {
    return null;
  }

  return (
    <a
      className="group inline-flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-foreground transition hover:border-white/20 hover:bg-white/10"
      href={`mailto:${email.value}`}
    >
      <Mail className="h-4 w-4 text-sky-300" />
      <div className="flex flex-col">
        <span className="font-medium">{email.value}</span>
        <span className="text-xs text-muted-foreground">
          {email.source}
        </span>
      </div>
    </a>
  );
}

function renderAddressCard(address?: PublicProfessionalAddress) {
  if (!address) {
    return null;
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-foreground">
      <div className="flex items-start gap-3">
        <MapPin className="mt-0.5 h-4 w-4 text-emerald-300" />
        <div className="flex flex-col">
          <span className="font-medium">{address.label}</span>
          <span className="mt-1 text-muted-foreground">{address.value}</span>
          <span className="mt-2 text-xs text-muted-foreground">{address.source}</span>
        </div>
      </div>
    </div>
  );
}

function formatTraceUrl(url: string) {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}${parsed.pathname === "/" ? "" : parsed.pathname}`;
  } catch {
    return url;
  }
}

function providerLabel(provider: EnrichmentProviderMeta) {
  return `${provider.name} · ${provider.source}`;
}

function traceTone(status: EnrichmentTraceItem["status"]) {
  switch (status) {
    case "accepted":
      return "border-emerald-400/20 bg-emerald-500/10 text-emerald-100";
    case "opened":
    case "candidate":
      return "border-sky-400/20 bg-sky-500/10 text-sky-100";
    case "blocked":
    case "error":
      return "border-amber-400/20 bg-amber-500/10 text-amber-100";
    case "rejected":
      return "border-rose-400/20 bg-rose-500/10 text-rose-100";
    default:
      return "border-white/10 bg-white/5 text-muted-foreground";
  }
}

export function ResultCard({ record }: ResultCardProps) {
  const router = useRouter();
  const [isExpanded, setIsExpanded] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enrichment, setEnrichment] = useState<EnrichmentApiResponse | null>(null);

  const actualEmail =
    enrichment?.email ??
    (record.email
      ? {
          value: record.email,
          source: "upstream-record",
          verifiedBy: "authorized upstream"
        }
      : undefined);
  const actualAddress = enrichment?.address;
  const traceItems =
    enrichment?.trace?.filter((item) => item.status !== "skipped").slice(0, 8) ?? [];

  async function handleLookup() {
    setIsExpanded(true);
    if (isLoading || enrichment) {
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/enrichment", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(buildRequestPayload(record))
      });

      if (response.status === 401) {
        toast.error("Sesi terkunci. Masukkan PIN lagi.");
        router.push("/");
        router.refresh();
        return;
      }

      if (!response.ok) {
        throw new Error("Gagal mencari kontak dan sosial.");
      }

      const payload = (await response.json()) as EnrichmentApiResponse;
      setEnrichment(payload);

      if (payload.warnings.length > 0) {
        toast.message("Lookup publik mengalami kendala", {
          description: payload.warnings.join(" ")
        });
      }
    } catch (lookupError) {
      const message =
        lookupError instanceof Error
          ? lookupError.message
          : "Terjadi error saat enrichment.";
      setError(message);
      toast.error(message);
    } finally {
      setIsLoading(false);
    }
  }

  const hasRenderableResults =
    Boolean(actualEmail) || Boolean(actualAddress) || Boolean(enrichment?.profiles.length);

  return (
    <motion.article
      className="glass rounded-[32px] p-6"
      initial="hidden"
      animate="visible"
      variants={springCard}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <Badge variant="accent" className="w-fit">
            {record.status || "Status tidak tersedia"}
          </Badge>
          <h3 className="mt-4 font-display text-2xl font-semibold tracking-tight text-foreground">
            {record.name}
          </h3>
          <p className="mt-2 text-sm text-muted-foreground">
            NIM {record.nim || "Tidak tersedia"}
          </p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/5 p-3 text-muted-foreground">
          <GraduationCap className="h-5 w-5 text-sky-200" />
        </div>
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl border border-white/10 bg-black/10 p-4">
          <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
            University
          </p>
          <p className="mt-2 text-sm font-medium text-foreground">{record.university}</p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-black/10 p-4">
          <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
            Major
          </p>
          <p className="mt-2 text-sm font-medium text-foreground">{record.major}</p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-black/10 p-4">
          <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
            Entry Year
          </p>
          <p className="mt-2 text-sm font-medium text-foreground">{record.entryYear}</p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-black/10 p-4">
          <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
            Campus Code
          </p>
          <p className="mt-2 text-sm font-medium uppercase text-foreground">
            {record.universityShort}
          </p>
        </div>
      </div>

      <div className="mt-6 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <ShieldCheck className="h-4 w-4 text-emerald-300" />
          High-precision enrichment only
        </div>
        <Button onClick={handleLookup} variant="secondary">
          {isLoading ? (
            <>
              <LoaderCircle className="h-4 w-4 animate-spin" />
              Mencari...
            </>
          ) : (
            <>
              <Search className="h-4 w-4" />
              Cari Kontak & Profil
            </>
          )}
        </Button>
      </div>

      {isExpanded ? (
        <div className="mt-6 rounded-[28px] border border-white/10 bg-black/10 p-5">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <UserRoundCheck className="h-4 w-4 text-sky-300" />
            Kontak & Profil
            {enrichment ? (
              <span className="ml-auto inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-muted-foreground">
                <DatabaseZap className="h-3.5 w-3.5 text-amber-300" />
                {enrichment.source === "cache" ? "cache hit" : "live lookup"}
              </span>
            ) : null}
          </div>

          {isLoading ? (
            <div className="mt-4 space-y-3">
              <Skeleton className="h-14 w-full rounded-2xl" />
              <div className="grid gap-3 sm:grid-cols-2">
                <Skeleton className="h-12 rounded-2xl" />
                <Skeleton className="h-12 rounded-2xl" />
              </div>
            </div>
          ) : error ? (
            <p className="mt-4 rounded-2xl border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
              {error}
            </p>
          ) : hasRenderableResults ? (
            <div className="mt-4 space-y-4">
              {renderEmailBadge(actualEmail)}
              {renderAddressCard(actualAddress)}

              {enrichment?.profiles.length ? (
                <div className="flex flex-wrap gap-3">
                  {enrichment.profiles.map((profile) => (
                    <a
                      key={profile.platform}
                      className={cn(
                        "inline-flex items-center gap-3 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-foreground transition hover:border-white/20 hover:bg-white/10"
                      )}
                      href={profile.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <span className="font-medium">{iconMap[profile.platform]}</span>
                      <span className="text-muted-foreground">
                        {profileHandleLabel(profile.platform, profile.username)}
                      </span>
                    </a>
                  ))}
                </div>
              ) : null}
            </div>
          ) : (
            <p className="mt-4 text-sm text-muted-foreground">Tidak ditemukan.</p>
          )}

          {enrichment ? (
            <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/10 px-3 py-1">
                  <Telescope className="h-3.5 w-3.5 text-sky-300" />
                  {enrichment.meta?.browserVisitedCount ?? 0} halaman dibuka
                </div>
                {enrichment.meta?.browserFollowupMs ? (
                  <div className="rounded-full border border-white/10 bg-black/10 px-3 py-1">
                    {enrichment.meta.browserFollowupMs}ms
                  </div>
                ) : null}
                {enrichment.meta?.providers
                  .filter((provider) => provider.source !== "skipped")
                  .map((provider) => (
                    <div
                      key={`${provider.name}:${provider.source}`}
                      className="rounded-full border border-white/10 bg-black/10 px-3 py-1"
                    >
                      {providerLabel(provider)}
                    </div>
                  ))}
              </div>

              {traceItems.length ? (
                <div className="mt-4 space-y-2">
                  {traceItems.map((item) => (
                    <div
                      key={`${item.stage}:${item.status}:${item.url}:${item.source}`}
                      className="rounded-2xl border border-white/10 bg-black/10 p-3"
                    >
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span
                          className={cn(
                            "rounded-full border px-2 py-1 uppercase tracking-[0.18em]",
                            traceTone(item.status)
                          )}
                        >
                          {item.status}
                        </span>
                        <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-muted-foreground">
                          {item.stage}
                        </span>
                        <a
                          className="truncate text-foreground underline decoration-white/20 underline-offset-4"
                          href={item.url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {formatTraceUrl(item.url)}
                        </a>
                      </div>
                      <p className="mt-2 text-sm text-muted-foreground">{item.detail}</p>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </motion.article>
  );
}

export function ResultCardSkeleton() {
  return (
    <div className="glass rounded-[32px] p-6">
      <Skeleton className="h-6 w-24 rounded-full" />
      <Skeleton className="mt-4 h-8 w-2/3" />
      <Skeleton className="mt-2 h-4 w-1/3" />
      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        <Skeleton className="h-24 rounded-2xl" />
        <Skeleton className="h-24 rounded-2xl" />
        <Skeleton className="h-24 rounded-2xl" />
        <Skeleton className="h-24 rounded-2xl" />
      </div>
      <Skeleton className="mt-6 h-11 rounded-full" />
    </div>
  );
}
