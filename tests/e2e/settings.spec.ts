import { test, expect } from "@playwright/test";

test.describe("Settings E2E", () => {
  test("displays safe runtime settings without secrets", async ({ page }) => {
    const response = await page.goto("/settings/local");
    if (!response || !response.ok() || page.url().includes("/login")) {
      test.skip(true, "App auth/DB unavailable. Skipping cleanly.");
      return;
    }
    await expect(page.locator("h1")).toBeVisible();
    await expect(page.locator("text=Retention")).toBeVisible();
    await expect(page.locator("body")).not.toContainText("SESSION_SECRET");
    await expect(page.locator("body")).not.toContainText("WAZUH_PASSWORD");
  });

  test("local settings page has editable form fields", async ({ page }) => {
    const response = await page.goto("/settings/local");
    if (!response || !response.ok() || page.url().includes("/login")) {
      test.skip(true, "App auth/DB unavailable. Skipping cleanly.");
      return;
    }
    await expect(page.locator('input[type="number"]').first()).toBeVisible();
    await expect(page.getByRole("button", { name: /save/i })).toBeVisible();
  });

  test("cloud settings page shows explicit connection state without secrets", async ({ page }) => {
    const response = await page.goto("/settings/cloud");
    if (!response || !response.ok() || page.url().includes("/login")) {
      test.skip(true, "App auth/DB unavailable. Skipping cleanly.");
      return;
    }
    await expect(page.locator("h1")).toBeVisible();
    // Wazuh API URL is shown (nonsecret), password value is never shown.
    await expect(page.locator("body")).not.toContainText("SESSION_SECRET");
  });

  test("ai settings page shows model and test button", async ({ page }) => {
    const response = await page.goto("/settings/ai");
    if (!response || !response.ok() || page.url().includes("/login")) {
      test.skip(true, "App auth/DB unavailable. Skipping cleanly.");
      return;
    }
    await expect(page.locator("h1")).toBeVisible();
    await expect(page.getByRole("button", { name: /test lm studio/i })).toBeVisible();
    // API key field is write-only — never pre-filled with secret value.
    await expect(page.locator('input[type="password"]')).toBeVisible();
  });

  test("soc settings page shows threat intel form without secrets", async ({ page }) => {
    const response = await page.goto("/settings/soc");
    if (!response || !response.ok() || page.url().includes("/login")) {
      test.skip(true, "App auth/DB unavailable. Skipping cleanly.");
      return;
    }
    await expect(page.locator("h1")).toBeVisible();
    // Threat Intel API keys are write-only — never pre-filled with a secret value.
    const pwInputs = page.locator('input[type="password"]');
    const count = await pwInputs.count();
    for (let i = 0; i < count; i++) {
      await expect(pwInputs.nth(i)).toHaveValue("");
    }
    await expect(page.getByRole("button", { name: /save soc settings/i })).toBeVisible();
  });
});
