"use client";

import { Database, HardDriveDownload, Layers3, Sparkles } from "lucide-react";
import { motion } from "framer-motion";

import type { CacheStatusResponse } from "@/lib/types";
import { fadeInUp } from "@/lib/motion";

interface CacheStatusProps {
  cacheStatus: CacheStatusResponse | null;
  lastSource: string;
  localCacheHit: boolean;
}

export function CacheStatus({
  cacheStatus,
  lastSource,
  localCacheHit
}: CacheStatusProps) {
  const searchSummary = cacheStatus?.summaries.find(
    (summary) => summary.namespace === "search"
  );
  const enrichmentSummary = cacheStatus?.summaries.find(
    (summary) => summary.namespace === "enrichment"
  );

  return (
    <motion.div
      className="grid gap-4 md:grid-cols-3"
      initial="hidden"
      animate="visible"
      variants={fadeInUp}
    >
      <div className="glass rounded-[28px] p-5">
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <Layers3 className="h-4 w-4 text-sky-300" />
          Cache Pipeline
        </div>
        <div className="mt-3 text-lg font-semibold text-foreground">
          {localCacheHit ? "Layer 1: LocalStorage" : `Source: ${lastSource}`}
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          Client cache 24 jam, server JSON cache 7 hari, lalu PDDIKTI public API.
        </p>
      </div>

      <div className="glass rounded-[28px] p-5">
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <HardDriveDownload className="h-4 w-4 text-emerald-300" />
          Search Cache
        </div>
        <div className="mt-3 text-lg font-semibold text-foreground">
          {searchSummary ? `${searchSummary.fresh}/${searchSummary.total}` : "--"}
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          Entri search yang masih fresh di cache server.
        </p>
      </div>

      <div className="glass rounded-[28px] p-5">
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <Database className="h-4 w-4 text-fuchsia-300" />
          Enrichment Cache
        </div>
        <div className="mt-3 flex items-center justify-between">
          <div className="text-lg font-semibold text-foreground">
            {enrichmentSummary ? `${enrichmentSummary.fresh}/${enrichmentSummary.total}` : "--"}
          </div>
          <Sparkles className="h-4 w-4 text-amber-300" />
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          Kontak dan sosial yang lolos high-precision validation.
        </p>
      </div>
    </motion.div>
  );
}
