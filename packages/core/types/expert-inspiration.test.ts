import { describe, expect, it } from "vitest";
import { parseExpertSession } from "./expert-inspiration";

describe("parseExpertSession", () => {
  it("defaults missing arrays and counts for a partial session payload", () => {
    const session = parseExpertSession({
      id: "s1",
      workspace_id: "w1",
      question: "What should we do?",
      status: "running",
      concurrency_limit: 3,
      selected_skill_ids: ["a1"],
      created_at: "2026-05-17T00:00:00Z",
      updated_at: "2026-05-17T00:00:00Z",
    });

    expect(session.selected_skill_ids).toEqual(["a1"]);
    expect(session.summary).toBe("");
    expect(session.error_message).toBe("");
    expect(session.events).toEqual([]);
  });
});
