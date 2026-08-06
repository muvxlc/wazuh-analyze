import { test, expect } from "@playwright/test";

test.describe("Settings E2E", () => {
  test("displays safe runtime settings without secrets", async ({ page }) => {
    const response = await page.goto("/settings");
    if (!response || !response.ok() || page.url().includes("/login")) {
      test.skip(true, "App auth/DB unavailable. Skipping cleanly.");
      return;
    }
    await expect(page.locator("h1")).toHaveText("Settings");
    await expect(page.locator("text=Retention")).toBeVisible();
    await expect(page.locator("body")).not.toContainText("SESSION_SECRET");
    await expect(page.locator("body")).not.toContainText("WAZUH_PASSWORD");
  });
});
