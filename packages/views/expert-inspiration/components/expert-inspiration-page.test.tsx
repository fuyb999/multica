import { fireEvent, render, screen } from "@testing-library/react";
import type { SkillSummary } from "@multica/core/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ExpertInspirationPage } from "./expert-inspiration-page";

const queryState = vi.hoisted(() => ({
  skills: [] as SkillSummary[],
  sessions: [],
  invalidateQueries: vi.fn(),
  mutateAsync: vi.fn(),
}));

vi.mock("../../chat", () => ({
  ChatWindow: ({
    embedded,
    titleOverride,
    inputDisabled,
    inputDisabledReason,
    hideAgentControls,
  }: {
    embedded?: boolean;
    titleOverride?: string;
    inputDisabled?: boolean;
    inputDisabledReason?: string;
    hideAgentControls?: boolean;
  }) => (
    <section
      data-testid="embedded-chat-window"
      data-embedded={String(embedded)}
      data-input-disabled={String(inputDisabled)}
      data-hide-agent-controls={String(hideAgentControls)}
    >
      <h2>{titleOverride}</h2>
      {inputDisabledReason && <p>{inputDisabledReason}</p>}
      <button type="button" aria-label="AI分析师 chat send button">
        发送
      </button>
    </section>
  ),
}));

vi.mock("@multica/core/hooks", () => ({
  useWorkspaceId: () => "ws-1",
}));

vi.mock("@multica/core/workspace/queries", () => ({
  expertInspirationSessionOptions: (wsId: string) => ({
    queryKey: ["workspace", wsId, "expert-inspiration"],
  }),
  skillListOptions: (wsId: string) => ({
    queryKey: ["workspace", wsId, "skills"],
  }),
  workspaceKeys: {
    expertInspiration: (wsId: string) => ["workspace", wsId, "expert-inspiration"],
  },
}));

vi.mock("@multica/core/realtime", () => ({
  useWSReconnect: () => undefined,
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey?: readonly unknown[] }) => {
    const key = queryKey?.join(":") ?? "";
    if (key.includes("skills")) return { data: queryState.skills };
    if (key.includes("expert-inspiration")) return { data: queryState.sessions };
    return { data: [] };
  },
  useQueryClient: () => ({ invalidateQueries: queryState.invalidateQueries }),
  useMutation: () => ({ mutateAsync: queryState.mutateAsync, isPending: false }),
}));

function makeSkill(
  id: string,
  name: string,
  description: string,
  config: Record<string, unknown> = {},
): SkillSummary {
  return {
    id,
    workspace_id: "ws-1",
    name,
    description,
    config,
    created_by: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
}

const groupedSkills = [
  makeSkill("military-1", "军事战略专家", "聚焦战争、国防、防务与作战推演"),
  makeSkill("military-2", "军工装备专家", "跟踪武器、军工、导弹与海空军建设"),
  makeSkill("economy-1", "宏观经济专家", "", {
    introduction: "研究宏观经济、贸易、金融与产业链变化",
  }),
  makeSkill("economy-2", "产业供应链专家", "覆盖市场、投资、消费与供应链"),
  makeSkill("politics-1", "政治外交专家", "分析外交政策、地缘政治与国际关系"),
  makeSkill("politics-2", "治理政策专家", "", {
    persona: { focus: "政府治理、监管、立法和公共事务" },
  }),
];

describe("ExpertInspirationPage", () => {
  beforeEach(() => {
    queryState.skills = groupedSkills;
    queryState.sessions = [];
    queryState.invalidateQueries.mockClear();
    queryState.mutateAsync.mockClear();
  });

  it("groups expert skills by introduction and renders the embedded AI分析师 chat shell", () => {
    render(<ExpertInspirationPage />);

    expect(screen.getByText("专家灵感")).toBeInTheDocument();
    expect(screen.getByText("专家选择树")).toBeInTheDocument();
    expect(screen.getByText("军事战略专家")).toBeInTheDocument();
    expect(screen.getByText("宏观经济专家")).toBeInTheDocument();
    expect(screen.getByText("政治外交专家")).toBeInTheDocument();
    expect(screen.getByText("治理政策专家")).toBeInTheDocument();
    expect(
      screen.getByText("并发数表示最多同时执行多少位专家，不限制你可以选择多少位专家。"),
    ).toBeInTheDocument();

    const chatWindow = screen.getByTestId("embedded-chat-window");
    expect(chatWindow).toHaveAttribute("data-embedded", "true");
    expect(chatWindow).toHaveAttribute("data-hide-agent-controls", "true");
    expect(screen.getByText("专家灵感 · AI分析师 聊天展开态")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "AI分析师 chat send button" })).toBeInTheDocument();
  });

  it("allows selecting all experts without capping selection at the concurrency value", () => {
    render(<ExpertInspirationPage />);

    const chatWindow = screen.getByTestId("embedded-chat-window");
    expect(chatWindow).toHaveAttribute("data-input-disabled", "true");
    expect(screen.getByText("先从左侧选择一位或多位专家，然后输入问题。")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /全选 6 位专家/ }));

    expect(screen.getByText("已选 6 位专家")).toBeInTheDocument();
    expect(screen.getByText("并发 3")).toBeInTheDocument();
    expect(chatWindow).toHaveAttribute("data-input-disabled", "false");
  });
});
