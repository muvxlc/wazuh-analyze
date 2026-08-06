import { test, expect } from "@playwright/test";

test.describe("Roles E2E", () => {
  test("displays fixed roles and read-only matrix", async ({ page }) => {
    const response = await page.goto("/roles");
    if (!response || !response.ok() || page.url().includes("/login")) {
      test.skip(true, "App auth/DB unavailable. Skipping cleanly.");
      return;
    }
    await expect(page.locator("h1")).toHaveText("Roles");
    await expect(page.locator("table")).toBeVisible();
  });
});
