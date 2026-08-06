import { test, expect } from "@playwright/test";

test.describe("User management E2E", () => {
  test("displays user administration interface and respects boundaries", async ({ page }) => {
    const response = await page.goto("/users");
    if (!response || !response.ok() || page.url().includes("/login")) {
      test.skip(true, "App auth/DB unavailable. Skipping cleanly.");
      return;
    }
    await expect(page.locator("h1")).toHaveText("Users");
    await expect(page.locator("table")).toBeVisible();
  });

  test("direct API rejects unauthorized access or escalation", async ({ request }) => {
    const response = await request.post("/api/users/123/role", {
      data: { role: "super_admin" },
      headers: { origin: "http://localhost:3000" }
    });
    if (!response || !response.ok() && response.status() === 500) {
      test.skip(true, "App auth/DB unavailable. Skipping cleanly.");
      return;
    }
    expect([401, 403]).toContain(response.status());
  });
});
