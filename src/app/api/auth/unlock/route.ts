import { NextRequest, NextResponse } from "next/server";

import {
  AUTH_COOKIE_NAME,
  createUnlockToken,
  getPinCookieMaxAge,
  isValidPin
} from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const payload = (await request.json()) as { pin?: string };

    if (!payload.pin || !isValidPin(payload.pin)) {
      return NextResponse.json(
        {
          error: "PIN tidak valid."
        },
        { status: 401 }
      );
    }

    const response = NextResponse.json({ ok: true }, { status: 200 });
    response.cookies.set({
      name: AUTH_COOKIE_NAME,
      value: await createUnlockToken(),
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: getPinCookieMaxAge()
    });

    return response;
  } catch {
    return NextResponse.json(
      {
        error: "Payload PIN tidak valid."
      },
      { status: 400 }
    );
  }
}
