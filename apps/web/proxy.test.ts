import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "./proxy";

function makeRequest(pathname: string, cookies: Record<string, string> = {}) {
  const cookieHeader = Object.entries(cookies)
    .map(([key, value]) => `${key}=${value}`)
    .join("; ");
  return new NextRequest(`https://app.multica.test${pathname}`, {
    headers: cookieHeader ? { cookie: cookieHeader } : undefined,
  });
}

describe("proxy", () => {
  it("redirects logged-out root requests to login", () => {
    const response = proxy(makeRequest("/"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://app.multica.test/login");
  });

  it("keeps logged-in root requests on the last workspace", () => {
    const response = proxy(
      makeRequest("/", {
        multica_logged_in: "true",
        last_workspace_slug: "acme",
      }),
    );
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://app.multica.test/acme/issues");
  });
});
