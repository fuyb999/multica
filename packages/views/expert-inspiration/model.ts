import type { SkillSummary } from "@multica/core/types";

export type AnalysisSessionStatus = "idle" | "running" | "completed";
export type AnalysisRunStatus = "queued" | "running" | "completed";

export type AnalysisTraceKind =
  | "session_started"
  | "input_normalized"
  | "expert_dispatched"
  | "tokens_generated"
  | "tool_call_started"
  | "tool_call_finished"
  | "es_query_started"
  | "es_query_finished"
  | "citations_collected"
  | "expert_opinion_ready"
  | "synthesis_progress"
  | "session_completed";

export interface AnalysisTraceEvent {
  id: string;
  kind: AnalysisTraceKind;
  title: string;
  detail: string;
  expertId?: string;
  expertName?: string;
  batch?: number;
  confidence?: number;
  citations?: number;
  tokens?: string[];
  tools?: string[];
}

export interface ExpertRunState {
  skillId: string;
  skillName: string;
  description: string;
  status: AnalysisRunStatus;
  confidence: number;
  citations: number;
  tokens: string[];
  tools: string[];
  opinion: string;
  evidence: string[];
}

export interface AnalysisSessionState {
  question: string;
  concurrency: number;
  status: AnalysisSessionStatus;
  summary: string;
  events: AnalysisTraceEvent[];
  runs: Record<string, ExpertRunState>;
}

export interface AnalysisPlan {
  events: AnalysisTraceEvent[];
  expertIds: string[];
}

function splitQuestionTerms(question: string): string[] {
  return question
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 4);
}

function chunk<T>(input: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < input.length; i += size) {
    out.push(input.slice(i, i + size));
  }
  return out;
}

function makeOpinion(agentName: string, batch: number, tokens: string[]): string {
  const lead = tokens.slice(0, 2).join(", ") || "the prompt";
  return `${agentName} recommends using evidence around ${lead} before acting on batch ${batch + 1}.`;
}

function buildEvidence(agentName: string, question: string, batch: number): string[] {
  const terms = splitQuestionTerms(question);
  return [
    `${agentName} evidence ${batch + 1}: ${terms[0] ?? "query"} matched the primary index.`,
    `${agentName} evidence ${batch + 1}: corroborated by a second ES hit.`,
  ];
}

export function buildAnalysisPlan(
  question: string,
  experts: SkillSummary[],
  concurrency: number,
): AnalysisPlan {
  const selected = experts.slice();
  const queue = chunk(selected, Math.max(1, concurrency));
  const baseTerms = splitQuestionTerms(question);
  const events: AnalysisTraceEvent[] = [
    {
      id: "event-session-started",
      kind: "session_started",
      title: "Session started",
      detail: `Analysing question with ${selected.length} expert${selected.length === 1 ? "" : "s"}.`,
    },
    {
      id: "event-input-normalized",
      kind: "input_normalized",
      title: "Input normalized",
      detail: `Normalized question into ${baseTerms.length} terms: ${baseTerms.join(", ") || "none"}.`,
      tokens: baseTerms,
    },
  ];

  queue.forEach((batchExperts, batchIndex) => {
    batchExperts.forEach((skill) => {
      events.push({
        id: `event-dispatch-${skill.id}`,
        kind: "expert_dispatched",
        title: "Expert dispatched",
        detail: `${skill.name} entered wave ${batchIndex + 1}.`,
        expertId: skill.id,
        expertName: skill.name,
        batch: batchIndex,
      });
      const tokens = splitQuestionTerms(`${question} ${skill.name}`).slice(0, 4);
      events.push({
        id: `event-tokens-${skill.id}`,
        kind: "tokens_generated",
        title: "Tokens generated",
        detail: `Tokenized query for ${skill.name}: ${tokens.join(" · ")}.`,
        expertId: skill.id,
        expertName: skill.name,
        batch: batchIndex,
        tokens,
      });
      events.push({
        id: `event-tool-start-${skill.id}`,
        kind: "tool_call_started",
        title: "Tool call started",
        detail: `Tokenizer and planner tool stack started for ${skill.name}.`,
        expertId: skill.id,
        expertName: skill.name,
        batch: batchIndex,
        tools: ["tokenizer", "planner"],
      });
      events.push({
        id: `event-tool-finish-${skill.id}`,
        kind: "tool_call_finished",
        title: "Tool call finished",
        detail: `Planner emitted ES query skeleton for ${skill.name}.`,
        expertId: skill.id,
        expertName: skill.name,
        batch: batchIndex,
        tools: ["tokenizer", "planner"],
      });
      events.push({
        id: `event-es-start-${skill.id}`,
        kind: "es_query_started",
        title: "ES query started",
        detail: `Searching evidence for ${skill.name} in the configured ES index.`,
        expertId: skill.id,
        expertName: skill.name,
        batch: batchIndex,
      });
      events.push({
        id: `event-es-finish-${skill.id}`,
        kind: "es_query_finished",
        title: "ES query finished",
        detail: `Retrieved 2 evidence snippets for ${skill.name}.`,
        expertId: skill.id,
        expertName: skill.name,
        batch: batchIndex,
      });
      events.push({
        id: `event-citations-${skill.id}`,
        kind: "citations_collected",
        title: "Citations collected",
        detail: `Collected 2 citations for ${skill.name}.`,
        expertId: skill.id,
        expertName: skill.name,
        batch: batchIndex,
        citations: 2,
      });
      events.push({
        id: `event-opinion-${skill.id}`,
        kind: "expert_opinion_ready",
        title: "Expert opinion ready",
        detail: makeOpinion(skill.name, batchIndex, tokens),
        expertId: skill.id,
        expertName: skill.name,
        batch: batchIndex,
        confidence: 68 + (batchIndex * 7 + tokens.length) % 18,
        citations: 2,
      });
    });
  });

  events.push({
    id: "event-synthesis-progress",
    kind: "synthesis_progress",
    title: "Synthesis in progress",
    detail: `Merged ${selected.length} expert opinion${selected.length === 1 ? "" : "s"} into a single answer.`,
  });
  events.push({
    id: "event-session-completed",
    kind: "session_completed",
    title: "Session completed",
    detail: "All expert outputs were synthesized with citations preserved.",
  });

  return { events, expertIds: selected.map((skill) => skill.id) };
}

export function createInitialSession(question: string, concurrency: number, experts: SkillSummary[]): AnalysisSessionState {
  const runs: Record<string, ExpertRunState> = {};
  for (const skill of experts) {
    runs[skill.id] = {
      skillId: skill.id,
      skillName: skill.name,
      description: skill.description ?? "",
      status: "queued",
      confidence: 0,
      citations: 0,
      tokens: [],
      tools: [],
      opinion: "",
      evidence: [],
    };
  }
  return {
    question,
    concurrency,
    status: "idle",
    summary: "",
    events: [],
    runs,
  };
}

export function applyTraceEvent(
  session: AnalysisSessionState,
  event: AnalysisTraceEvent,
): AnalysisSessionState {
  const events = [...session.events, event];
  const runs = { ...session.runs };
  const current = event.expertId ? runs[event.expertId] : undefined;

  switch (event.kind) {
    case "session_started":
      return {
        ...session,
        status: "running",
        events,
      };
    case "input_normalized":
      return {
        ...session,
        events,
        summary: event.detail,
      };
    case "expert_dispatched":
      if (current) current.status = "running";
      break;
    case "tokens_generated":
      if (current) current.tokens = event.tokens ?? current.tokens;
      break;
    case "tool_call_started":
      if (current) current.tools = Array.from(new Set([...current.tools, ...(event.tools ?? [])]));
      break;
    case "tool_call_finished":
      if (current) current.tools = Array.from(new Set([...current.tools, ...(event.tools ?? [])]));
      break;
    case "es_query_started":
      if (current) current.tools = Array.from(new Set([...current.tools, "es.search"]));
      break;
    case "es_query_finished":
      if (current) current.evidence = buildEvidence(current.skillName, session.question, event.batch ?? 0);
      break;
    case "citations_collected":
      if (current) current.citations = event.citations ?? current.citations;
      break;
    case "expert_opinion_ready":
      if (current) {
        current.status = "completed";
        current.confidence = event.confidence ?? current.confidence;
        current.citations = event.citations ?? current.citations;
        current.opinion = event.detail;
      }
      break;
    case "synthesis_progress":
      return {
        ...session,
        events,
        runs,
        summary: event.detail,
      };
    case "session_completed":
      return {
        ...session,
        status: "completed",
        events,
        runs,
        summary: event.detail,
      };
  }

  return {
    ...session,
    events,
    runs,
  };
}

export function formatConfidence(value: number): string {
  return `${Math.max(0, Math.min(100, Math.round(value)))}%`;
}
