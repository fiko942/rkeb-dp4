import { NextRequest, NextResponse } from "next/server";

import { isUnlockedRequest } from "@/lib/auth";

export async function requireUnlockedApi(request: NextRequest) {
  const unlocked = await isUnlockedRequest(request);

  if (unlocked) {
    return null;
  }

  return NextResponse.json(
    {
      error: "Akses ditolak. Masukkan PIN terlebih dahulu."
    },
    { status: 401 }
  );
}
