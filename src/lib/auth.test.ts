import { createUnlockToken, isValidPin, verifyUnlockToken } from "@/lib/auth";

describe("auth", () => {
  it("accepts the configured pin", () => {
    expect(isValidPin("085213")).toBe(true);
    expect(isValidPin("000000")).toBe(false);
  });

  it("creates and verifies unlock tokens", async () => {
    const token = await createUnlockToken();

    await expect(verifyUnlockToken(token)).resolves.toBe(true);
    await expect(verifyUnlockToken(`${token}tampered`)).resolves.toBe(false);
  });
});
