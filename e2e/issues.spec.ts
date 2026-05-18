import { test, expect } from "@playwright/test";
import { loginWithApi, createTestApi, resetIssueViewState } from "./helpers";
import type { TestApiClient } from "./fixtures";

test.describe("Issues", () => {
  let api: TestApiClient;
  let workspaceSlug: string;

  test.beforeEach(async ({ page }) => {
    api = await createTestApi();
    workspaceSlug = await loginWithApi(page, api);
    await resetIssueViewState(page, workspaceSlug);
  });

  test.afterEach(async () => {
    if (api) {
      await api.cleanup();
    }
  });

  test("issues page loads with board view", async ({ page }) => {
    await api.createIssue("E2E Board View " + Date.now());
    await page.goto(`/${workspaceSlug}/issues`);

    // Board columns should be visible
    const main = page.locator("main");
    await expect(main.getByText("Backlog")).toBeVisible({ timeout: 10000 });
    await expect(main.getByText("Todo")).toBeVisible();
    await expect(main.getByText("In Progress")).toBeVisible();
  });

  test("can switch from board to list view", async ({ page }) => {
    const title = "E2E List Switch " + Date.now();
    await api.createIssue(title);
    await page.goto(`/${workspaceSlug}/issues`);
    await expect(page.locator("main").getByText("Backlog")).toBeVisible({
      timeout: 10000,
    });

    // Switch to list view
    await page.click("text=List");
    await expect(page.getByText(title)).toBeVisible();
  });

  test("can create a new issue", async ({ page }) => {
    const newIssueButton = page.getByRole("button", { name: "New Issue" });
    await expect(newIssueButton).toBeVisible();
    await newIssueButton.click();
    await page.getByRole("button", { name: "Switch to Manual" }).click();

    const title = "E2E Created " + Date.now();
    const titleInput = page.getByRole("textbox", { name: "Issue title" });
    await expect(titleInput).toBeVisible();
    await titleInput.fill(title);
    await page.getByRole("button", { name: "Create Issue" }).click();

    await expect(page.getByText("Issue created")).toBeVisible({ timeout: 10000 });
    await expect(
      page.getByRole("region", { name: /Notifications/ }).getByText(title),
    ).toBeVisible();

    await page.getByRole("button", { name: "View issue" }).click();
    await page.waitForURL(/\/issues\/[\w-]+/);
    await expect(
      page.locator("main").getByRole("textbox", { name: "Issue title" }),
    ).toContainText(title, { timeout: 10000 });
  });

  test("can navigate to issue detail page", async ({ page }) => {
    // Create a known issue via API so the test controls its own fixture
    const issue = await api.createIssue("E2E Detail Test " + Date.now());

    // Reload to see the new issue
    await page.goto(`/${workspaceSlug}/issues`);

    const issueLink = page.getByRole("link", { name: new RegExp(issue.title) });
    await expect(issueLink).toBeVisible({ timeout: 5000 });
    await issueLink.click();

    await page.waitForURL(/\/issues\/[\w-]+/);

    await expect(
      page.locator("main").getByRole("textbox", { name: "Issue title" }),
    ).toContainText(issue.title, { timeout: 10000 });
    // Should show breadcrumb link back to Issues
    await expect(
      page.locator("a", { hasText: "Issues" }).first(),
    ).toBeVisible();
  });

  test("can dismiss issue creation", async ({ page }) => {
    await page.getByRole("button", { name: "New Issue" }).click();
    await page.getByRole("button", { name: "Switch to Manual" }).click();

    const titleInput = page.getByRole("textbox", { name: "Issue title" });
    await expect(titleInput).toBeVisible();

    await page.keyboard.press("Escape");

    await expect(titleInput).not.toBeVisible();
    await expect(page.getByRole("button", { name: "New Issue" })).toBeVisible();
  });
});
