import { test, expect } from "@playwright/test";
import { loginAsDefault } from "./helpers";

test.describe("Settings", () => {
  test("updating workspace name reflects in sidebar immediately", async ({
    page,
  }) => {
    await loginAsDefault(page);

    const originalName = "E2E Workspace";
    await expect(page.getByRole("button", { name: /E2E Workspace/ })).toBeVisible();

    await page.getByRole("link", { name: "Settings" }).click();
    await page.waitForURL("**/settings");
    await page.getByRole("tab", { name: "General" }).click();

    const nameInput = page.locator('input[type="text"]').first();
    const newName = "Renamed WS " + Date.now();

    try {
      await nameInput.fill(newName);

      await page.getByRole("button", { name: "Save" }).focus();
      await page.keyboard.press("Enter");
      await expect(page.getByText("Workspace settings saved").last()).toBeVisible({
        timeout: 5000,
      });

      await expect(page.getByRole("button", { name: new RegExp(newName) })).toBeVisible();
    } finally {
      await nameInput.fill(originalName);
      await page.getByRole("button", { name: "Save" }).focus();
      await page.keyboard.press("Enter");
      await expect(page.getByText("Workspace settings saved").last()).toBeVisible({
        timeout: 5000,
      });
    }
  });
});
