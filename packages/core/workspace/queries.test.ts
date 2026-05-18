import { describe, expect, it } from "vitest";
import { workspaceKeys } from "./queries";

describe("workspaceKeys", () => {
  it("includes inspiration sessions under the workspace namespace", () => {
    expect(workspaceKeys.expertInspiration("ws-1")).toEqual([
      "workspaces",
      "ws-1",
      "expert-inspiration",
    ]);
  });
});
