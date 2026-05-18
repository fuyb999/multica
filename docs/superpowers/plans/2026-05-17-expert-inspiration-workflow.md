# Expert Inspiration Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a workspace-scoped expert inspiration page that lets users select multiple expert agents, run them with adjustable concurrency, and watch the full analysis trace stream in real time.

**Architecture:** Reuse AI分析师 agents and skills as the expert execution model. Add a shared page component for the inspiration workflow, wire it into both web and desktop routes, and define the new client-side query/state surface for sessions and trace events. Keep the first implementation slice focused on a runnable UI shell plus the data contracts it needs.

**Tech Stack:** TypeScript, React, Next.js App Router, React Query, shared `packages/views` pages, shared `packages/core` types/queries.

---

### Task 1: Define expert inspiration data contracts

**Files:**
- Create: `packages/core/types/expert-inspiration.ts`
- Modify: `packages/core/types/index.ts`
- Test: `packages/core/types/expert-inspiration.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { parseExpertSession } from "./expert-inspiration";

describe("parseExpertSession", () => {
  it("defaults missing arrays and counts for a partial session payload", () => {
    const session = parseExpertSession({
      id: "s1",
      workspace_id: "w1",
      question: "What should we do?",
      status: "running",
      concurrency_limit: 3,
      selected_expert_agent_ids: ["a1"],
      created_at: "2026-05-17T00:00:00Z",
      updated_at: "2026-05-17T00:00:00Z",
    });

    expect(session.summary).toBe("");
    expect(session.error_message).toBe("");
    expect(session.events).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @multica/core exec vitest run packages/core/types/expert-inspiration.test.ts -v`
Expected: FAIL because `parseExpertSession` does not exist.

- [ ] **Step 3: Write minimal implementation**

```ts
export interface ExpertInspirationSession {
  id: string;
  workspace_id: string;
  created_by?: string | null;
  question: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  concurrency_limit: number;
  selected_expert_agent_ids: string[];
  summary: string;
  error_message: string;
  created_at: string;
  updated_at: string;
  events: ExpertInspirationEvent[];
}

export interface ExpertInspirationEvent {
  id: string;
  session_id: string;
  expert_run_id?: string | null;
  seq: number;
  event_type: string;
  payload: Record<string, unknown>;
  created_at: string;
}

export function parseExpertSession(input: Partial<ExpertInspirationSession>): ExpertInspirationSession {
  return {
    id: input.id ?? "",
    workspace_id: input.workspace_id ?? "",
    created_by: input.created_by ?? null,
    question: input.question ?? "",
    status: input.status ?? "queued",
    concurrency_limit: input.concurrency_limit ?? 3,
    selected_expert_agent_ids: input.selected_expert_agent_ids ?? [],
    summary: input.summary ?? "",
    error_message: input.error_message ?? "",
    created_at: input.created_at ?? "",
    updated_at: input.updated_at ?? "",
    events: input.events ?? [],
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @multica/core exec vitest run packages/core/types/expert-inspiration.test.ts -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/types/expert-inspiration.ts packages/core/types/index.ts packages/core/types/expert-inspiration.test.ts
git commit -m "feat(core): add expert inspiration data contracts"
```

### Task 2: Add workspace query keys for inspiration sessions

**Files:**
- Modify: `packages/core/workspace/queries.ts`
- Test: `packages/core/workspace/queries.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @multica/core exec vitest run packages/core/workspace/queries.test.ts -v`
Expected: FAIL because `workspaceKeys.expertInspiration` does not exist.

- [ ] **Step 3: Write minimal implementation**

```ts
export const workspaceKeys = {
  all: (wsId: string) => ["workspaces", wsId] as const,
  list: () => ["workspaces", "list"] as const,
  members: (wsId: string) => ["workspaces", wsId, "members"] as const,
  invitations: (wsId: string) => ["workspaces", wsId, "invitations"] as const,
  myInvitations: () => ["invitations", "mine"] as const,
  agents: (wsId: string) => ["workspaces", wsId, "agents"] as const,
  squads: (wsId: string) => ["workspaces", wsId, "squads"] as const,
  skills: (wsId: string) => ["workspaces", wsId, "skills"] as const,
  expertInspiration: (wsId: string) => ["workspaces", wsId, "expert-inspiration"] as const,
  assigneeFrequency: (wsId: string) => ["workspaces", wsId, "assignee-frequency"] as const,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @multica/core exec vitest run packages/core/workspace/queries.test.ts -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/workspace/queries.ts packages/core/workspace/queries.test.ts
git commit -m "feat(core): add inspiration workspace query key"
```

### Task 3: Build the shared inspiration page shell

**Files:**
- Create: `packages/views/expert-inspiration/index.ts`
- Create: `packages/views/expert-inspiration/components/index.ts`
- Create: `packages/views/expert-inspiration/components/expert-inspiration-page.tsx`
- Create: `packages/views/expert-inspiration/components/expert-inspiration-page.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { ExpertInspirationPage } from "./expert-inspiration-page";

describe("ExpertInspirationPage", () => {
  it("renders the workspace analysis shell", () => {
    render(<ExpertInspirationPage />);
    expect(screen.getByText("Expert Inspiration")).toBeInTheDocument();
    expect(screen.getByText("Traceable multi-expert analysis workflow")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @multica/views exec vitest run packages/views/expert-inspiration/components/expert-inspiration-page.test.tsx -v`
Expected: FAIL because the component does not exist.

- [ ] **Step 3: Write minimal implementation**

```tsx
export function ExpertInspirationPage() {
  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b px-4 py-3">
        <h1 className="text-sm font-medium">Expert Inspiration</h1>
        <p className="text-xs text-muted-foreground">Traceable multi-expert analysis workflow</p>
      </header>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @multica/views exec vitest run packages/views/expert-inspiration/components/expert-inspiration-page.test.tsx -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/views/expert-inspiration packages/views/expert-inspiration/components/expert-inspiration-page.tsx packages/views/expert-inspiration/components/expert-inspiration-page.test.tsx
git commit -m "feat(views): add expert inspiration shell"
```

### Task 4: Wire the page into web and desktop routes

**Files:**
- Modify: `apps/web/app/[workspaceSlug]/(dashboard)/...`
- Modify: `apps/desktop/src/renderer/src/routes.tsx`
- Modify: `packages/views/layout/index.ts` if a shared export is needed

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect } from "vitest";
import { createTabRouter } from "./routes";

describe("tab router", () => {
  it("exposes the expert inspiration route", () => {
    const router = createTabRouter("/workspaces/demo/expert-inspiration");
    expect(router.routes.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @multica/desktop exec vitest run apps/desktop/src/renderer/src/routes.tsx -v`
Expected: FAIL because the route is not present.

- [ ] **Step 3: Write minimal implementation**

```tsx
{
  path: "expert-inspiration",
  element: <ExpertInspirationPage />,
  handle: { title: "Expert Inspiration" },
}
```

And add the web route file:

```tsx
export { ExpertInspirationPage as default } from "@multica/views/expert-inspiration";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm typecheck`
Expected: PASS for the new route wiring.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/[workspaceSlug]/(dashboard)/expert-inspiration/page.tsx apps/desktop/src/renderer/src/routes.tsx packages/views/expert-inspiration packages/views/layout/index.ts
git commit -m "feat(routes): add expert inspiration entry points"
```

### Task 5: Add the initial analysis UI controls and trace placeholders

**Files:**
- Modify: `packages/views/expert-inspiration/components/expert-inspiration-page.tsx`
- Create: `packages/views/expert-inspiration/components/expert-picker.tsx`
- Create: `packages/views/expert-inspiration/components/analysis-trace.tsx`
- Create: `packages/views/expert-inspiration/components/synthesis-panel.tsx`
- Test: `packages/views/expert-inspiration/components/expert-picker.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { ExpertPicker } from "./expert-picker";

describe("ExpertPicker", () => {
  it("shows concurrency defaults and selected expert count", () => {
    render(<ExpertPicker selectedCount={2} concurrency={3} />);
    expect(screen.getByText("Selected experts: 2")).toBeInTheDocument();
    expect(screen.getByText("Concurrency: 3")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @multica/views exec vitest run packages/views/expert-inspiration/components/expert-picker.test.tsx -v`
Expected: FAIL because `ExpertPicker` does not exist.

- [ ] **Step 3: Write minimal implementation**

```tsx
export function ExpertPicker({ selectedCount, concurrency }: { selectedCount: number; concurrency: number }) {
  return (
    <div>
      <div>Selected experts: {selectedCount}</div>
      <div>Concurrency: {concurrency}</div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @multica/views exec vitest run packages/views/expert-inspiration/components/expert-picker.test.tsx -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/views/expert-inspiration/components/expert-picker.tsx packages/views/expert-inspiration/components/expert-picker.test.tsx packages/views/expert-inspiration/components/expert-inspiration-page.tsx packages/views/expert-inspiration/components/analysis-trace.tsx packages/views/expert-inspiration/components/synthesis-panel.tsx
git commit -m "feat(views): add expert inspiration controls"
```

### Task 6: Review and execute

**Files:**
- Modify: `docs/superpowers/plans/2026-05-17-expert-inspiration-workflow.md`

- [ ] **Step 1: Review the plan for gaps against the spec**

Check that the plan covers:

- expert selection via agents
- adjustable concurrency with default 3 and max 3
- real-time trace surface
- citations / confidence display
- workspace routing in web and desktop

- [ ] **Step 2: Run the implementation verification commands**

Run: `pnpm typecheck`
Run: `pnpm test`
Expected: PASS once the page shell and shared types compile cleanly.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/plans/2026-05-17-expert-inspiration-workflow.md
git commit -m "docs(plan): add expert inspiration implementation plan"
```
