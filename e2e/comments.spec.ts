import { test, expect, type Page } from "@playwright/test";
import { createTestApi, loginWithApi } from "./helpers";
import type { TestApiClient } from "./fixtures";

test.describe("Comments", () => {
  let api: TestApiClient;
  let issueId: string;
  let issueTitle: string;
  let workspaceSlug: string;

  test.beforeEach(async ({ page }) => {
    api = await createTestApi();
    issueTitle = "E2E Comment Test " + Date.now();
    const issue = await api.createIssue(issueTitle);
    issueId = issue.id;
    workspaceSlug = await loginWithApi(page, api);
  });

  test.afterEach(async () => {
    await api.cleanup();
  });

  async function openIssueDetail(page: Page) {
    await page.goto(`/${workspaceSlug}/issues/${issueId}`);
    await page.waitForURL(new RegExp(`/${workspaceSlug}/issues/${issueId}`));

    await expect(
      page.locator("main").getByRole("textbox", { name: "Issue title" }),
    ).toContainText(issueTitle, { timeout: 10000 });
  }

  async function getCommentComposer(page: Page) {
    const composer = page
      .locator("div.bg-card.pb-8.ring-border")
      .filter({ has: page.locator(".rich-text-editor") })
      .last();
    await expect(composer).toBeVisible();
    const editor = composer.locator(".rich-text-editor");
    await expect(editor).toBeVisible();
    const submitBtn = composer.locator("button").last();
    return { editor, submitBtn };
  }

  test("can add a comment on an issue", async ({ page }) => {
    await openIssueDetail(page);

    const commentText = "E2E comment " + Date.now();
    const { editor, submitBtn } = await getCommentComposer(page);
    await editor.fill(commentText);

    await expect(submitBtn).toBeEnabled();
    await editor.press(process.platform === "darwin" ? "Meta+Enter" : "Control+Enter");

    await expect(page.locator(`text=${commentText}`)).toBeVisible({
      timeout: 5000,
    });
  });

  test("comment submit button is disabled when empty", async ({ page }) => {
    await openIssueDetail(page);

    const { submitBtn } = await getCommentComposer(page);
    await expect(submitBtn).toBeDisabled();
  });
});
