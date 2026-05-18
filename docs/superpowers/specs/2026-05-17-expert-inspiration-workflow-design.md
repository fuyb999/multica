# Expert Inspiration Workflow Design

**Goal:** Build a workspace-scoped expert inspiration page where users select multiple expert agents, run them with adjustable concurrency (default 3, max 3), stream the full analysis process in real time, preserve citations and confidence, and generate a final synthesized answer.

**Architecture:** Reuse AI分析师 `agent` and `skill` as the execution layer. Add a new analysis-session layer that orchestrates expert dispatch, tracks ordered trace events, and synthesizes results. The page stays fully workspace-scoped and uses the existing realtime stack to stream milestones back to the UI.

**Tech Stack:** Go backend, sqlc/PostgreSQL, existing AI分析师 websocket/realtime channel, Next.js App Router, `packages/core` query/state layer, `packages/views` shared page components.

---

## 1. Product Shape

This feature is not a single chat box. It is a traceable analysis workflow.

The user flow is:

1. Open the workspace-scoped inspiration page.
2. Select one or more expert agents.
3. Choose concurrency, with a user-controlled range of 1 to 3 and a default of 3.
4. Enter a question.
5. Start the run.
6. Watch each expert progress through the pipeline in real time.
7. Inspect citations, tool calls, ES queries, and confidence per expert.
8. Read a synthesized final answer that reconciles all expert outputs.

The expert source is the research-skill library under `/Users/fuyb/Desktop/research-skills`. Those skills are imported into AI分析师 and attached to expert agents, so the UI talks in terms of experts while the backend executes with normal AI分析师 agents and skills.

## 2. Core Workflow

The analysis pipeline is:

`input normalization -> expert dispatch -> tokenization / query generation -> tool calls -> ES retrieval -> evidence filtering and citation collection -> expert opinion -> conflict resolution / confidence calibration -> synthesis`

Each step must be visible in the UI as it happens.

The output of each expert run must include:

- normalized query text
- tokenized terms / extracted concepts
- tool call log
- ES query payloads
- returned evidence
- citation list
- confidence score
- final expert opinion

The final synthesis must use the expert opinions and the cited evidence, not an uncited hidden summary.

## 3. Data Model

Use a session-oriented model.

### 3.1 `analysis_session`

Represents one user question.

Fields:

- `id`
- `workspace_id`
- `created_by`
- `question`
- `status` (`queued`, `running`, `completed`, `failed`, `cancelled`)
- `concurrency_limit`
- `selected_expert_agent_ids`
- `summary`
- `error_message`
- `created_at`
- `updated_at`

### 3.2 `analysis_expert_run`

Represents one expert's execution within a session.

Fields:

- `id`
- `session_id`
- `expert_agent_id`
- `status`
- `confidence`
- `opinion`
- `tokenized_terms`
- `tool_trace`
- `es_trace`
- `citation_count`
- `started_at`
- `finished_at`

### 3.3 `analysis_event`

Represents the ordered trace stream.

Fields:

- `id`
- `session_id`
- `expert_run_id` nullable
- `seq`
- `event_type`
- `payload`
- `created_at`

Event types should cover:

- `session_started`
- `expert_dispatched`
- `query_normalized`
- `tokens_generated`
- `tool_call_started`
- `tool_call_finished`
- `es_query_started`
- `es_query_finished`
- `evidence_filtered`
- `citations_collected`
- `expert_opinion_ready`
- `synthesis_progress`
- `session_completed`

## 4. Execution Model

The backend owns orchestration. The frontend only renders state and sends control actions.

1. A new session is created with the user question, selected experts, and concurrency limit.
2. The orchestrator schedules expert runs under a semaphore capped by the chosen concurrency.
3. Each expert run emits ordered events as it progresses.
4. The page subscribes to the session stream and updates the session timeline and expert cards immediately.
5. When all expert runs finish, the synthesizer produces a final answer and closes the session.

Expert failures do not fail the whole session by default. The session should keep moving as long as at least one expert can continue.

## 5. ES and Skill Binding

The research-skill library is treated as the expert configuration source.

Each imported skill can define:

- the ES index or alias to query
- field mapping rules
- query hints / prompt hints
- citation field preferences

Workspace-level ES connection details remain in workspace configuration. Skill-level metadata chooses what to query and how to cite it.

The orchestrator must record the exact ES query payload that was used so the trace can show the real retrieval path instead of a paraphrase.

## 6. UI Design

The page is a single workspace-scoped analysis surface.

It should contain:

- a question composer
- an expert picker
- a concurrency control
- a live session status header
- a vertical trace timeline
- per-expert cards showing status, confidence, and citation count
- a citation / evidence panel
- a final synthesis panel

Each expert card should expose:

- current step
- tokenized terms
- tool calls
- ES hits
- citations
- confidence
- final opinion

The live trace should feel incremental, not only final-state-based. The user must be able to see the pipeline move.

## 7. Realtime Behavior

Use the existing realtime channel pattern to deliver session events.

Requirements:

- the UI must receive milestone events as they happen
- reconnecting clients must be able to refetch the latest session snapshot and continue from the last seen sequence
- event ordering must be stable per session
- milestone updates should be idempotent so duplicate delivery does not corrupt the trace

## 8. Error Handling

The session must degrade gracefully.

- If one expert fails, continue the remaining experts.
- If ES returns no hits, emit a low-confidence opinion with an empty citation list.
- If ES times out, mark the expert as degraded and continue the session.
- If synthesis cannot reconcile opinions, produce a summary that explicitly notes disagreement rather than hiding it.
- If the connection drops, the page should reconnect and refresh the latest snapshot.

## 9. Compatibility with AI分析师

This feature should fit existing AI分析师 patterns:

- experts are agents
- skills remain workspace-scoped
- the analysis page is workspace-scoped
- realtime uses the current event-driven model
- server state stays in the query layer
- client-only selection state stays in local state

Do not introduce a parallel concept that replaces agents or skills.

## 10. Testing

Backend tests must cover:

- session creation with multiple experts
- concurrency limiting
- event ordering
- ES query generation and citation collection
- low-confidence fallback when no evidence exists
- synthesis behavior when expert opinions conflict

Frontend tests must cover:

- expert selection and concurrency control
- rendering of incremental trace events
- per-expert confidence and citation display
- recovery after a reconnect snapshot refresh

End-to-end coverage should verify at least one complete session with multiple experts and live trace updates.

## 11. Scope Boundary

This design intentionally stops at the analysis workflow itself.

Out of scope for this iteration:

- generic workflow builder
- arbitrary non-ES data sources
- open-ended multi-turn conversation memory
- replacing the existing AI分析师 agent model

