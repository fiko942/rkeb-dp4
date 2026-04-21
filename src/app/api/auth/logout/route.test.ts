import { AUTH_COOKIE_NAME } from "@/lib/auth";
import { POST } from "@/app/api/auth/logout/route";

describe("POST /api/auth/logout", () => {
  it("clears the unlock cookie", async () => {
    const response = await POST();

    expect(response.status).toBe(200);
    expect(response.cookies.get(AUTH_COOKIE_NAME)?.maxAge).toBe(0);
  });
});
