import { expect, test } from "@playwright/test";

test("unlocks the app and shows visible search cards", async ({ page }) => {
  await page.route("**/api/enrichment", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        source: "live",
        address: {
          label: "Lokasi profesional",
          value: "Bandung, Indonesia",
          source: "github-public-profile",
          verifiedBy: "university, major"
        },
        profiles: [],
        warnings: []
      })
    });
  });

  await page.goto("/");
  await page.getByLabel("PIN Access").fill("085213");
  await page.getByRole("button", { name: "Buka" }).click();
  await page.waitForURL("**/dashboard");

  await page.getByLabel("Cari alumni").fill("dita");
  await page.waitForTimeout(1500);
  await expect(page.locator("article").first()).toBeVisible();
});
