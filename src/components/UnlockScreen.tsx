"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Github, Globe, LockKeyhole, ShieldCheck } from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fadeInUp, staggerContainer } from "@/lib/motion";

export function UnlockScreen() {
  const router = useRouter();
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleUnlock() {
    startTransition(async () => {
      setError(null);

      try {
        const response = await fetch("/api/auth/unlock", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ pin })
        });

        const payload = (await response.json()) as { error?: string };
        if (!response.ok) {
          throw new Error(payload.error ?? "PIN tidak valid.");
        }

        toast.success("AlmaTrace terbuka.");
        router.push("/dashboard");
        router.refresh();
      } catch (unlockError) {
        const message =
          unlockError instanceof Error
            ? unlockError.message
            : "Gagal membuka aplikasi.";
        setError(message);
        toast.error(message);
      }
    });
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-6 py-10">
      <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_top,rgba(27,156,252,0.26),transparent_38%),radial-gradient(circle_at_25%_25%,rgba(24,201,174,0.15),transparent_28%),radial-gradient(circle_at_80%_10%,rgba(244,114,182,0.14),transparent_24%)]" />

      <motion.div
        className="glass w-full max-w-md rounded-[36px] p-8 md:p-9"
        initial="hidden"
        animate="visible"
        variants={staggerContainer}
      >
        <motion.div variants={fadeInUp}>
          <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs uppercase tracking-[0.2em] text-sky-100">
            <ShieldCheck className="h-3.5 w-3.5" />
            Protected Access
          </div>
          <h1 className="mt-6 font-display text-4xl font-semibold tracking-[-0.03em] text-foreground">
            AlmaTrace
          </h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            Masukkan PIN untuk membuka dashboard alumni, cache pencarian, dan
            data kontak yang tersimpan.
          </p>
        </motion.div>

        <motion.div variants={fadeInUp} className="mt-8">
          <label className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
            PIN Access
          </label>
          <div className="mt-3 flex gap-3">
            <div className="relative flex-1">
              <LockKeyhole className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                aria-label="PIN Access"
                className="pl-11"
                inputMode="numeric"
                maxLength={6}
                placeholder="Masukkan PIN"
                type="password"
                value={pin}
                onChange={(event) => setPin(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    handleUnlock();
                  }
                }}
              />
            </div>
            <Button disabled={isPending} onClick={handleUnlock}>
              {isPending ? "Membuka..." : "Buka"}
            </Button>
          </div>

          {error ? (
            <p className="mt-4 rounded-2xl border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
              {error}
            </p>
          ) : (
            <p className="mt-4 text-xs text-muted-foreground">
              Sesi unlock berlaku 24 jam di browser yang sama.
            </p>
          )}

          <div className="mt-5 rounded-2xl border border-white/10 bg-white/5 p-4 text-xs text-muted-foreground">
            <p className="font-medium text-foreground">Versi open source</p>
            <div className="mt-3 space-y-2">
              <a
                className="inline-flex items-center gap-2 transition hover:text-foreground"
                href="https://github.com/fiko942/rkeb-dp4"
                target="_blank"
                rel="noreferrer"
              >
                <Github className="h-3.5 w-3.5" />
                github.com/fiko942/rkeb-dp4
              </a>
              <a
                className="inline-flex items-center gap-2 transition hover:text-foreground"
                href="https://rkeb-dp4.streampeg.com"
                target="_blank"
                rel="noreferrer"
              >
                <Globe className="h-3.5 w-3.5" />
                rkeb-dp4.streampeg.com
              </a>
              <p>
                PIN demo publik: <span className="font-semibold text-foreground">085213</span>
              </p>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </div>
  );
}
