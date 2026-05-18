"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bot,
  CheckCheck,
  ChevronRight,
  SlidersHorizontal,
  Sparkles,
} from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ChatMessage, ExpertInspirationSession, SkillSummary } from "@multica/core/types";
import { ChatWindow } from "../../chat";
import { useWorkspaceId } from "@multica/core/hooks";
import { api } from "@multica/core/api";
import {
  expertInspirationSessionOptions,
  skillListOptions,
  workspaceKeys,
} from "@multica/core/workspace/queries";
import { useWSReconnect } from "@multica/core/realtime";
import { Badge } from "@multica/ui/components/ui/badge";
import { Button } from "@multica/ui/components/ui/button";
import { Checkbox } from "@multica/ui/components/ui/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@multica/ui/components/ui/collapsible";
import { ScrollArea } from "@multica/ui/components/ui/scroll-area";
import { cn } from "@multica/ui/lib/utils";

type ExpertEvent = ExpertInspirationSession["events"][number];
type ExpertGroupId = "military" | "economy" | "politics";

const EXPERT_GROUPS: Array<{
  id: ExpertGroupId;
  label: string;
  hint: string;
  keywords: string[];
}> = [
  {
    id: "military",
    label: "军事",
    hint: "战略、战争、国防、军工",
    keywords: [
      "军事",
      "军队",
      "军方",
      "国防",
      "防务",
      "战争",
      "战役",
      "战术",
      "战略",
      "安全",
      "武器",
      "兵器",
      "军工",
      "作战",
      "海军",
      "陆军",
      "空军",
      "导弹",
      "military",
      "defense",
      "defence",
      "war",
      "army",
      "navy",
      "air force",
      "weapon",
      "security",
      "strategy",
    ],
  },
  {
    id: "economy",
    label: "经济",
    hint: "宏观、产业、贸易、增长",
    keywords: [
      "经济",
      "宏观",
      "产业",
      "行业",
      "市场",
      "贸易",
      "金融",
      "财政",
      "货币",
      "增长",
      "通胀",
      "投资",
      "消费",
      "供应链",
      "企业",
      "资本",
      "economy",
      "economic",
      "macro",
      "industry",
      "market",
      "trade",
      "finance",
      "fiscal",
      "monetary",
      "growth",
      "inflation",
      "investment",
      "supply chain",
    ],
  },
  {
    id: "politics",
    label: "政治",
    hint: "政策、外交、地缘、治理",
    keywords: [
      "政治",
      "政策",
      "政党",
      "政府",
      "外交",
      "地缘",
      "国际关系",
      "治理",
      "选举",
      "立法",
      "监管",
      "公共事务",
      "制度",
      "国家关系",
      "politic",
      "policy",
      "geopolit",
      "diplom",
      "government",
      "governance",
      "election",
      "regulation",
      "legislation",
      "international relations",
    ],
  },
];

const EXPERT_CONCURRENCY_MAX = 6;

function sessionStatusLabel(status?: ExpertInspirationSession["status"]) {
  switch (status) {
    case "queued":
      return "排队中";
    case "running":
      return "分析中";
    case "completed":
      return "已完成";
    case "failed":
      return "失败";
    case "cancelled":
      return "已取消";
    default:
      return "尚未开始";
  }
}

function sessionProgress(session?: ExpertInspirationSession) {
  switch (session?.status) {
    case "queued":
      return 16;
    case "running":
      return 68;
    case "completed":
    case "failed":
    case "cancelled":
      return 100;
    default:
      return 0;
  }
}

function traceString(payload: Record<string, unknown>, key: string): string {
  return typeof payload[key] === "string" ? (payload[key] as string) : "";
}

function traceStrings(payload: Record<string, unknown>, key: string): string[] {
  const value = payload[key];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function stringifyConfigValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(stringifyConfigValue).filter(Boolean).join(" ");
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, nested]) => `${key} ${stringifyConfigValue(nested)}`)
      .filter(Boolean)
      .join(" ");
  }
  return "";
}

function configHint(skill: SkillSummary): string {
  const preferredKeys = [
    "introduction",
    "intro",
    "description",
    "summary",
    "persona",
    "role",
    "category",
    "group",
    "domain",
    "track",
    "topic",
    "tags",
    "instructions",
    "system_prompt",
    "prompt",
  ];
  const preferred = preferredKeys
    .map((key) => stringifyConfigValue(skill.config[key]))
    .filter(Boolean)
    .join(" ");
  return preferred || stringifyConfigValue(skill.config);
}

function resolveExpertGroup(skill: SkillSummary): ExpertGroupId {
  const haystack = [skill.name, skill.description, configHint(skill)]
    .join(" ")
    .toLowerCase();
  const scored = EXPERT_GROUPS.map((group) => ({
    id: group.id,
    score: group.keywords.reduce(
      (total, keyword) => total + (haystack.includes(keyword.toLowerCase()) ? 1 : 0),
      0,
    ),
  })).sort((a, b) => b.score - a.score);

  return scored[0]?.score ? scored[0].id : "politics";
}

function buildExpertGroups(skills: SkillSummary[]) {
  const grouped: Record<ExpertGroupId, SkillSummary[]> = {
    military: [],
    economy: [],
    politics: [],
  };
  skills.forEach((skill) => {
    grouped[resolveExpertGroup(skill)].push(skill);
  });
  return EXPERT_GROUPS.map((group) => ({
    ...group,
    skills: grouped[group.id].slice().sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN")),
  }));
}

function eventSkillId(event: ExpertEvent): string {
  return (
    traceString(event.payload, "skill_id") ||
    traceString(event.payload, "expert_id") ||
    event.expert_run_id ||
    ""
  );
}

function eventSkillName(event: ExpertEvent, skillNameById: Map<string, string>): string {
  const skillId = eventSkillId(event);
  return (
    (skillId ? skillNameById.get(skillId) : undefined) ||
    traceString(event.payload, "expert_name") ||
    traceString(event.payload, "agent_name") ||
    "专家"
  );
}

function SessionStatusBadge({ status }: { status?: ExpertInspirationSession["status"] }) {
  const tone =
    status === "completed"
      ? "default"
      : status === "running"
        ? "secondary"
        : status === "failed"
          ? "destructive"
          : "outline";
  return <Badge variant={tone as never}>{sessionStatusLabel(status)}</Badge>;
}

function ExpertTreeRow({
  skill,
  selected,
  onToggle,
}: {
  skill: SkillSummary;
  selected: boolean;
  onToggle: (skill: SkillSummary) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onToggle(skill)}
      className={cn(
        "flex w-full items-start gap-3 rounded-xl border px-3 py-3 text-left transition-colors",
        selected
          ? "border-primary bg-primary/5"
          : "border-border/70 bg-background hover:bg-muted/50",
      )}
      aria-pressed={selected}
    >
      <Checkbox checked={selected} tabIndex={-1} className="pointer-events-none mt-0.5" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Bot className="h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="truncate text-sm font-medium">{skill.name}</div>
        </div>
        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
          {skill.description || "暂无描述"}
        </p>
      </div>
    </button>
  );
}

function expertSessionMessages(
  session: ExpertInspirationSession | undefined,
  draftQuestion: string,
  selectedCount: number,
  skillNameById: Map<string, string>,
): ChatMessage[] {
  const now = new Date().toISOString();
  const question = session?.question || draftQuestion.trim();
  const messages: ChatMessage[] = [];

  if (question) {
    messages.push({
      id: `${session?.id ?? "draft"}-question`,
      chat_session_id: session?.id ?? "expert-inspiration-draft",
      role: "user",
      content: question,
      task_id: null,
      created_at: session?.created_at || now,
    });
  }

  if (!session) {
    messages.push({
      id: "expert-inspiration-starter",
      chat_session_id: "expert-inspiration-draft",
      role: "assistant",
      content: selectedCount > 0
        ? `已选择 ${selectedCount} 位专家。请在下方输入问题，右侧使用 AI分析师 展开态聊天框发送。`
        : "先从左侧按军事、经济、政治选择专家，然后在下方输入问题。",
      task_id: null,
      created_at: now,
    });
    return messages;
  }

  const progress = sessionProgress(session);
  messages.push({
    id: `${session.id}-summary`,
    chat_session_id: session.id,
    role: "assistant",
    content: [
      `**综合总结 · ${sessionStatusLabel(session.status)}**`,
      `- 专家数：${session.selected_skill_ids.length}`,
      `- 并发数：${session.concurrency_limit}`,
      `- 进度：${progress}%`,
      "",
      session.summary || session.error_message || "分析正在进行，过程流会持续刷新。",
    ].join("\n"),
    task_id: null,
    created_at: session.updated_at || session.created_at,
  });

  for (const event of session.events.slice(-12)) {
    const title = traceString(event.payload, "title") || event.event_type;
    const detail =
      traceString(event.payload, "detail") ||
      traceString(event.payload, "summary") ||
      traceString(event.payload, "opinion") ||
      "等待更多分析输出…";
    const tokens = traceStrings(event.payload, "tokens");
    const tools = traceStrings(event.payload, "tools");
    const expertName = eventSkillName(event, skillNameById);
    const lines = [`**${title}**`, `专家：${expertName}`, detail];
    if (tokens.length > 0) lines.push(`Tokens：${tokens.join("、")}`);
    if (tools.length > 0) lines.push(`Tools：${tools.join("、")}`);
    messages.push({
      id: event.id,
      chat_session_id: session.id,
      role: "assistant",
      content: lines.join("\n"),
      task_id: null,
      created_at: event.created_at,
    });
  }

  return messages;
}

export function ExpertInspirationPage() {
  const wsId = useWorkspaceId();
  const qc = useQueryClient();
  const { data: skills = [] } = useQuery(skillListOptions(wsId));
  const { data: sessions = [] } = useQuery(expertInspirationSessionOptions(wsId));
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [concurrency, setConcurrency] = useState(3);

  const expertGroups = useMemo(() => buildExpertGroups(skills), [skills]);
  const visibleSkills = useMemo(
    () => expertGroups.flatMap((group) => group.skills),
    [expertGroups],
  );
  const skillNameById = useMemo(
    () => new Map(visibleSkills.map((skill) => [skill.id, skill.name])),
    [visibleSkills],
  );
  const selectedSkills = useMemo(
    () => visibleSkills.filter((skill) => selectedIds.has(skill.id)),
    [visibleSkills, selectedIds],
  );

  const selectedCount = selectedSkills.length;
  const totalExperts = visibleSkills.length;
  const latestSession = sessions[0];
  const composerConcurrencyMax = Math.max(
    1,
    Math.min(
      EXPERT_CONCURRENCY_MAX,
      selectedCount > 0 ? selectedCount : totalExperts || 1,
    ),
  );

  const chatMessages = useMemo(
    () => expertSessionMessages(latestSession, "", selectedCount, skillNameById),
    [latestSession, selectedCount, skillNameById],
  );

  useEffect(() => {
    setConcurrency((current) => Math.min(current, composerConcurrencyMax));
  }, [composerConcurrencyMax]);

  const createSessionState = useMutation({
    mutationFn: (content: string) =>
      api.createExpertInspirationSession(wsId, {
        question: content.trim(),
        concurrency_limit: Math.min(concurrency, Math.max(1, selectedCount)),
        selected_skill_ids: selectedSkills.map((skill) => skill.id),
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({
        queryKey: workspaceKeys.expertInspiration(wsId),
      });
    },
  });

  const canStart = selectedCount > 0 && !createSessionState.isPending;
  const allSelected = totalExperts > 0 && selectedCount === totalExperts;

  useWSReconnect(() => {
    qc.invalidateQueries({ queryKey: workspaceKeys.expertInspiration(wsId) });
  });

  const toggleSkill = (skill: SkillSummary) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(skill.id)) next.delete(skill.id);
      else next.add(skill.id);
      return next;
    });
  };

  const toggleGroup = (groupSkills: SkillSummary[]) => {
    if (groupSkills.length === 0) return;
    setSelectedIds((current) => {
      const next = new Set(current);
      const everySelected = groupSkills.every((skill) => next.has(skill.id));
      groupSkills.forEach((skill) => {
        if (everySelected) next.delete(skill.id);
        else next.add(skill.id);
      });
      return next;
    });
  };

  const toggleAll = () => {
    setSelectedIds(
      allSelected ? new Set() : new Set(visibleSkills.map((skill) => skill.id)),
    );
  };

  const startAnalysis = useCallback(
    async (content: string) => {
      const trimmed = content.trim();
      if (!trimmed || !canStart) return;
      await createSessionState.mutateAsync(trimmed);
    },
    [canStart, createSessionState],
  );

  return (
    <div className="flex min-h-screen w-full overflow-hidden bg-background">
      <aside className="flex w-full shrink-0 flex-col border-r bg-sidebar xl:w-[380px]">
        <div className="border-b px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 shrink-0 text-brand" />
                <h1 className="truncate text-sm font-semibold">专家灵感</h1>
              </div>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                左侧选择专家与并发数，右侧在完整聊天工作台中查看过程、观点与综合结论。
              </p>
            </div>
            <SessionStatusBadge status={latestSession?.status} />
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Badge variant="outline">已选 {selectedCount} 位专家</Badge>
            <Badge variant="secondary">并发 {concurrency}</Badge>
            <Badge variant="outline">会话 {sessions.length}</Badge>
          </div>
        </div>

        <ScrollArea className="flex-1">
          <div className="space-y-5 px-5 py-5">
            <section className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium">专家选择树</div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    按军事、经济、政治分组展示，可全选全部专家。
                  </p>
                </div>
                <Button type="button" variant="outline" size="sm" onClick={toggleAll}>
                  <CheckCheck className="h-3.5 w-3.5" />
                  {allSelected ? "清空选择" : `全选 ${totalExperts} 位专家`}
                </Button>
              </div>

              <div className="space-y-3">
                {expertGroups.map((group) => {
                  const groupCount = group.skills.length;
                  const groupSelectedCount = group.skills.filter((skill) => selectedIds.has(skill.id)).length;
                  return (
                    <Collapsible key={group.id} defaultOpen>
                      <div className="rounded-2xl border bg-card/70">
                        <div className="flex items-center justify-between gap-3 px-3 py-3">
                          <CollapsibleTrigger className="flex min-w-0 flex-1 items-center gap-2 text-left">
                            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform data-[state=open]:rotate-90" />
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <div className="text-sm font-medium">{group.label}</div>
                                <Badge variant="outline">{groupCount}</Badge>
                                {groupSelectedCount > 0 && (
                                  <Badge variant="secondary">已选 {groupSelectedCount}</Badge>
                                )}
                              </div>
                              <div className="mt-1 text-xs text-muted-foreground">
                                {group.hint}
                              </div>
                            </div>
                          </CollapsibleTrigger>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => toggleGroup(group.skills)}
                            disabled={groupCount === 0}
                          >
                            {groupSelectedCount === groupCount && groupCount > 0 ? "清空" : "全选"}
                          </Button>
                        </div>
                        <CollapsibleContent>
                          <div className="space-y-2 border-t px-3 py-3">
                            {group.skills.length > 0 ? (
                              group.skills.map((skill) => (
                                <ExpertTreeRow
                                  key={skill.id}
                                  skill={skill}
                                  selected={selectedIds.has(skill.id)}
                                  onToggle={toggleSkill}
                                />
                              ))
                            ) : (
                              <div className="rounded-xl border border-dashed bg-muted/20 px-3 py-4 text-xs text-muted-foreground">
                                当前分组暂无可用专家 skill。
                              </div>
                            )}
                          </div>
                        </CollapsibleContent>
                      </div>
                    </Collapsible>
                  );
                })}
              </div>
            </section>

            <section className="space-y-3 rounded-2xl border bg-card/70 p-4">
              <div>
                <div className="flex items-center gap-2 text-sm font-medium">
                  <SlidersHorizontal className="h-4 w-4 text-muted-foreground" />
                  并发设置
                </div>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  并发数表示最多同时执行多少位专家，不限制你可以选择多少位专家。
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {Array.from({ length: composerConcurrencyMax }, (_, index) => index + 1).map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setConcurrency(value)}
                    className={cn(
                      "rounded-full border px-3 py-1 text-xs transition-colors",
                      concurrency === value
                        ? "border-primary bg-primary/10 text-primary"
                        : "hover:bg-muted",
                    )}
                  >
                    {value}
                  </button>
                ))}
              </div>
            </section>
          </div>
        </ScrollArea>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col bg-sidebar">
        <ChatWindow
          embedded
          titleOverride="专家灵感 · AI分析师 聊天展开态"
          messagesOverride={chatMessages}
          onSendOverride={startAnalysis}
          isRunningOverride={createSessionState.isPending || latestSession?.status === "queued" || latestSession?.status === "running"}
          noAgentOverride={false}
          hideNewChatButton
          hideAgentControls
          disableUpload
          inputDisabled={!canStart}
          inputDisabledReason={
            selectedCount > 0
              ? undefined
              : "先从左侧选择一位或多位专家，然后输入问题。"
          }
        />
      </section>
    </div>
  );
}
