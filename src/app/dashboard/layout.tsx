import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { isUnlockedSession } from "@/lib/auth";

export default async function DashboardLayout({
  children
}: Readonly<{
  children: ReactNode;
}>) {
  const unlocked = await isUnlockedSession();

  if (!unlocked) {
    redirect("/");
  }

  return children;
}
