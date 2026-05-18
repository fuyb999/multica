export type ExpertInspirationSessionStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface ExpertInspirationEvent {
  id: string;
  session_id: string;
  workspace_id?: string | null;
  expert_run_id?: string | null;
  seq: number;
  event_type: string;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface ExpertInspirationSession {
  id: string;
  workspace_id: string;
  created_by?: string | null;
  question: string;
  status: ExpertInspirationSessionStatus;
  concurrency_limit: number;
  selected_skill_ids: string[];
  summary: string;
  error_message: string;
  created_at: string;
  updated_at: string;
  events: ExpertInspirationEvent[];
}

export interface ExpertPickerOption {
  skill_id: string;
  name: string;
  description: string;
}

export interface CreateExpertInspirationSessionRequest {
  question: string;
  concurrency_limit: number;
  selected_skill_ids: string[];
}

export function parseExpertSession(
  input: Partial<ExpertInspirationSession>,
): ExpertInspirationSession {
  return {
    id: input.id ?? "",
    workspace_id: input.workspace_id ?? "",
    created_by: input.created_by ?? null,
    question: input.question ?? "",
    status: input.status ?? "queued",
    concurrency_limit: input.concurrency_limit ?? 3,
    selected_skill_ids: input.selected_skill_ids ?? [],
    summary: input.summary ?? "",
    error_message: input.error_message ?? "",
    created_at: input.created_at ?? "",
    updated_at: input.updated_at ?? "",
    events: input.events ?? [],
  };
}
