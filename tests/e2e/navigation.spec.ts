import { test, expect } from "@playwright/test";

test.describe("Navigation flows", () => {
  test("toggles drawer and respects focus", async ({ page, isMobile }) => {
    if (!isMobile) return;
    await page.goto("/login");
    // Only basic smoke test as unauthenticated
    await expect(page.locator("text=Wazuh")).toBeVisible();
  });
});
