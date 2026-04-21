"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

export function LogoutButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          try {
            await fetch("/api/auth/logout", {
              method: "POST"
            });
          } finally {
            toast.message("Sesi AlmaTrace dikunci kembali.");
            router.push("/");
            router.refresh();
          }
        })
      }
    >
      <LogOut className="h-4 w-4" />
      {isPending ? "Mengunci..." : "Lock"}
    </Button>
  );
}
