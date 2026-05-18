import { expect, type Page } from "@playwright/test";
import { TestApiClient } from "./fixtures";

const E2E_WORKER_INDEX = process.env.TEST_WORKER_INDEX ?? "0";
export const DEFAULT_E2E_NAME = "E2E User";
export const DEFAULT_E2E_EMAIL = `e2e+${E2E_WORKER_INDEX}@multica.ai`;
const DEFAULT_E2E_WORKSPACE = `e2e-workspace-${E2E_WORKER_INDEX}`;

/**
 * Log in as the default E2E user and ensure the workspace exists first.
 * Authenticates via API (send-code → DB read → verify-code), then injects
 * the token into localStorage so the browser session is authenticated.
 *
 * Returns the E2E workspace slug so callers can build workspace-scoped URLs.
 */
export async function loginAsDefault(page: Page): Promise<string> {
  const api = new TestApiClient();
  await api.login(DEFAULT_E2E_EMAIL, DEFAULT_E2E_NAME);
  const workspace = await api.ensureWorkspace(
    "E2E Workspace",
    DEFAULT_E2E_WORKSPACE,
  );

  await authenticatePage(page, api.getToken());
  await page.goto(`/${workspace.slug}/issues`);
  await page.waitForURL("**/issues", { timeout: 10000 });
  await dismissStarterContentPrompt(page);
  return workspace.slug;
}

export async function loginWithApi(page: Page, api: TestApiClient): Promise<string> {
  const workspace = await api.ensureWorkspace(
    "E2E Workspace",
    DEFAULT_E2E_WORKSPACE,
  );

  await authenticatePage(page, api.getToken());
  await page.goto(`/${workspace.slug}/issues`);
  await page.waitForURL("**/issues", { timeout: 10000 });
  await dismissStarterContentPrompt(page);
  return workspace.slug;
}

async function authenticatePage(page: Page, token: string | null) {
  if (!token) throw new Error("test api client not logged in");

  await page.addInitScript((t) => {
    localStorage.setItem("multica_token", t);
  }, token);
}

async function dismissStarterContentPrompt(page: Page) {
  const dialog = page.getByRole("dialog", {
    name: "Welcome — add starter tasks?",
  });
  if (!(await dialog.isVisible().catch(() => false))) return;

  await dialog.getByRole("button", { name: "Start blank workspace" }).click();
  await expect(dialog).toBeHidden({ timeout: 10000 });
}

/**
 * Create a TestApiClient logged in as the default E2E user.
 * Call api.cleanup() in afterEach to remove test data created during the test.
 */
export async function createTestApi(): Promise<TestApiClient> {
  const api = new TestApiClient();
  await api.login(DEFAULT_E2E_EMAIL, DEFAULT_E2E_NAME);
  await api.ensureWorkspace("E2E Workspace", DEFAULT_E2E_WORKSPACE);
  return api;
}

export async function resetIssueViewState(page: Page, workspaceSlug: string) {
  await page.evaluate((slug) => {
    localStorage.removeItem(`multica_issues_view:${slug}`);
  }, workspaceSlug);
}

export async function openWorkspaceMenu(page: Page) {
  await page.getByRole("button", { name: /E2E Workspace/ }).click();
  await expect(page.locator('[data-slot="dropdown-menu-content"]')).toBeVisible();
}
