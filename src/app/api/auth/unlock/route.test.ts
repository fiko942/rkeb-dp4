import { NextRequest } from "next/server";

import { AUTH_COOKIE_NAME } from "@/lib/auth";
import { POST } from "@/app/api/auth/unlock/route";

describe("POST /api/auth/unlock", () => {
  it("rejects an invalid pin", async () => {
    const response = await POST(
      new NextRequest("http://localhost/api/auth/unlock", {
        method: "POST",
        body: JSON.stringify({ pin: "111111" })
      })
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "PIN tidak valid." });
  });

  it("sets the unlock cookie for a valid pin", async () => {
    const response = await POST(
      new NextRequest("http://localhost/api/auth/unlock", {
        method: "POST",
        body: JSON.stringify({ pin: "085213" })
      })
    );

    expect(response.status).toBe(200);
    expect(response.cookies.get(AUTH_COOKIE_NAME)?.value).toBeTruthy();
  });
});
