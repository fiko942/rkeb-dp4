import { redirect } from "next/navigation";

import { UnlockScreen } from "@/components/UnlockScreen";
import { isUnlockedSession } from "@/lib/auth";

export default async function HomePage() {
  const unlocked = await isUnlockedSession();

  if (unlocked) {
    redirect("/dashboard");
  }

  return <UnlockScreen />;
}
