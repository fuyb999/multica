# Built-in Research Skills Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `research-skills` as first-party built-in capabilities and make `es_context.search_context` available to research agents through a deployment-scoped ES tool preset.

**Architecture:** Add three explicit backend layers: built-in skill bundle registry, persisted ES data-source/profile records, and tool presets that render provider-specific MCP config. Extend agent-template materialization to pull from built-in bundles and merge presets into `agent.mcp_config`, then expose enough frontend metadata to show built-in/read-only skill state and template availability.

**Tech Stack:** Go, PostgreSQL/sqlc, embedded files, Next.js/React, TypeScript, TanStack Query, Vitest, Go tests.

---

## File Structure

### New backend files

- `server/internal/builtins/skills/loader.go`
  - load embedded skill bundles and validate manifests
- `server/internal/builtins/skills/types.go`
  - bundle and skill descriptor types
- `server/internal/builtins/skills/bundles/research-skills/...`
  - copied built-in skill assets from the current research-skills collection
- `server/internal/toolpreset/registry.go`
  - tool preset definitions and provider-specific render hooks
- `server/internal/toolpreset/es_context.go`
  - `es-context` preset implementation
- `server/internal/toolpreset/types.go`
  - preset and resolved config types

### Modified backend files

- `server/migrations/<next>_retrieval_sources.up.sql`
- `server/migrations/<next>_retrieval_sources.down.sql`
- `server/pkg/db/queries/retrieval.sql`
- `server/pkg/db/generated/*`
- `server/internal/handler/agent_template.go`
- `server/internal/handler/skill.go`
- `server/internal/handler/skill_create.go`
- `server/internal/handler/agent.go`
- `server/internal/agenttmpl/types.go`
- `server/internal/agenttmpl/loader.go`
- `server/internal/agenttmpl/templates/research-analyst.json`
- `server/pkg/agent/agent.go`
- `server/pkg/agent/claude_test.go`
- `server/pkg/agent/codex.go`
- `server/pkg/agent/codex_test.go`

### Modified frontend files

- `packages/core/types/agent.ts`
- `packages/core/types/index.ts`
- `packages/core/api/schemas.ts`
- `packages/views/skills/lib/origin.ts`
- `packages/views/skills/components/skill-columns.tsx`
- `packages/views/skills/components/skill-detail-page.tsx`
- `packages/views/agents/components/create-agent-dialog.tsx`
- `packages/views/agents/components/create-agent-dialog.test.tsx`
- localized strings under `packages/views/locales/*/skills.json`
- localized strings under `packages/views/locales/*/agents.json`

## Task 1: Persist Deployment Retrieval Configuration

**Files:**
- Create: `server/migrations/<next>_retrieval_sources.up.sql`
- Create: `server/migrations/<next>_retrieval_sources.down.sql`
- Create: `server/pkg/db/queries/retrieval.sql`
- Regenerate: `server/pkg/db/generated/*`
- Test: `server/internal/handler/handler_test.go`

- [ ] **Step 1: Write failing migration-backed tests for retrieval records**

Add tests that create one deployment-scoped ES source and one profile, then fetch
them by stable names:

```go
func TestDeploymentRetrievalConfigRoundTrip(t *testing.T) {
    source, err := testHandler.Queries.UpsertRetrievalDataSource(context.Background(), db.UpsertRetrievalDataSourceParams{
        ScopeType: "deployment",
        ScopeID:   pgtype.UUID{},
        Type:      "elasticsearch",
        Name:      "shared-research",
        Config:    []byte(`{"endpoint":"http://es:9200"}`),
        SecretRef: pgtype.Text{String: "secret/es", Valid: true},
        Enabled:   true,
    })
    if err != nil {
        t.Fatal(err)
    }
    profile, err := testHandler.Queries.UpsertRetrievalProfile(context.Background(), db.UpsertRetrievalProfileParams{
        DataSourceID: source.ID,
        Name:         "default-research-context",
        IndexAlias:   "research-docs",
        FieldMapping: []byte(`{"title":"title","summary":"summary"}`),
        QueryDefaults: []byte(`{"top_k":5}`),
        Enabled:      true,
    })
    if err != nil {
        t.Fatal(err)
    }
    if profile.Name != "default-research-context" {
        t.Fatalf("profile.Name = %q", profile.Name)
    }
}
```

- [ ] **Step 2: Run the targeted Go test and confirm failure**

Run:

```bash
cd server && go test ./internal/handler -run TestDeploymentRetrievalConfigRoundTrip
```

Expected: FAIL because retrieval tables and sqlc queries do not exist yet.

- [ ] **Step 3: Add schema and sqlc queries**

Migration sketch:

```sql
CREATE TABLE retrieval_data_source (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    scope_type text NOT NULL CHECK (scope_type IN ('deployment', 'workspace')),
    scope_id uuid NULL,
    type text NOT NULL,
    name text NOT NULL,
    config jsonb NOT NULL DEFAULT '{}'::jsonb,
    secret_ref text,
    enabled boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT retrieval_data_source_scope_name_unique
        UNIQUE NULLS NOT DISTINCT (scope_type, scope_id, name)
);

CREATE TABLE retrieval_profile (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    data_source_id uuid NOT NULL REFERENCES retrieval_data_source(id) ON DELETE CASCADE,
    name text NOT NULL,
    index_alias text NOT NULL,
    field_mapping jsonb NOT NULL DEFAULT '{}'::jsonb,
    query_defaults jsonb NOT NULL DEFAULT '{}'::jsonb,
    enabled boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (data_source_id, name)
);
```

`retrieval.sql` should include:

```sql
-- name: UpsertRetrievalDataSource :one
INSERT INTO retrieval_data_source (
    scope_type, scope_id, type, name, config, secret_ref, enabled
) VALUES (
    $1, $2, $3, $4, $5, $6, $7
)
ON CONFLICT ON CONSTRAINT retrieval_data_source_scope_name_unique DO UPDATE SET
    type = EXCLUDED.type,
    config = EXCLUDED.config,
    secret_ref = EXCLUDED.secret_ref,
    enabled = EXCLUDED.enabled,
    updated_at = now()
RETURNING *;

-- name: GetRetrievalDataSourceByScopeAndName :one
SELECT * FROM retrieval_data_source
WHERE scope_type = $1
  AND scope_id IS NOT DISTINCT FROM $2
  AND name = $3;

-- name: UpsertRetrievalProfile :one
INSERT INTO retrieval_profile (
    data_source_id, name, index_alias, field_mapping, query_defaults, enabled
) VALUES (
    $1, $2, $3, $4, $5, $6
)
ON CONFLICT (data_source_id, name) DO UPDATE SET
    index_alias = EXCLUDED.index_alias,
    field_mapping = EXCLUDED.field_mapping,
    query_defaults = EXCLUDED.query_defaults,
    enabled = EXCLUDED.enabled,
    updated_at = now()
RETURNING *;

-- name: GetRetrievalProfileBySourceAndName :one
SELECT * FROM retrieval_profile
WHERE data_source_id = $1
  AND name = $2;
```

- [ ] **Step 4: Regenerate sqlc and rerun the test**

Run:

```bash
make sqlc
cd server && go test ./internal/handler -run TestDeploymentRetrievalConfigRoundTrip
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/migrations server/pkg/db server/internal/handler/handler_test.go
git commit -m "feat: add retrieval data source persistence"
```

## Task 2: Seed Deployment ES Configuration From Server Config

**Files:**
- Modify: `server/cmd/server/main.go` or the existing config/bootstrap file that wires handlers
- Create: `server/internal/service/retrieval_config.go`
- Test: `server/internal/service/retrieval_config_test.go`

- [ ] **Step 1: Write failing tests for startup seeding**

```go
func TestEnsureDeploymentRetrievalConfigCreatesDefaultRecords(t *testing.T) {
    cfg := DeploymentRetrievalConfig{
        SourceName:   "shared-research",
        Endpoint:     "http://es:9200",
        SecretRef:    "secret/es",
        ProfileName:  "default-research-context",
        IndexAlias:   "research-docs",
        FieldMapping: json.RawMessage(`{"title":"title"}`),
        QueryDefaults: json.RawMessage(`{"top_k":5}`),
    }

    got, err := EnsureDeploymentRetrievalConfig(context.Background(), queries, cfg)
    if err != nil {
        t.Fatal(err)
    }
    if got.Profile.Name != "default-research-context" {
        t.Fatalf("profile.Name = %q", got.Profile.Name)
    }
}
```

- [ ] **Step 2: Run the service test and confirm failure**

Run:

```bash
cd server && go test ./internal/service -run TestEnsureDeploymentRetrievalConfigCreatesDefaultRecords
```

Expected: FAIL because the service does not exist.

- [ ] **Step 3: Implement config parsing and upsert service**

Add a small service that:

- validates required deployment config fields
- upserts one deployment-scoped `retrieval_data_source`
- upserts one `retrieval_profile`
- returns both records for later preset resolution

Use environment-backed configuration names such as:

```text
MULTICA_ES_CONTEXT_ENDPOINT
MULTICA_ES_CONTEXT_SECRET_REF
MULTICA_ES_CONTEXT_INDEX_ALIAS
MULTICA_ES_CONTEXT_FIELD_MAPPING_JSON
MULTICA_ES_CONTEXT_QUERY_DEFAULTS_JSON
```

- [ ] **Step 4: Wire startup seeding**

On server startup:

- if all required env vars are present, seed/refresh the deployment records
- if none are present, leave the preset unconfigured
- if only some are present, fail startup with a clear configuration error

- [ ] **Step 5: Run tests**

Run:

```bash
cd server && go test ./internal/service
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/internal/service server/cmd/server
git commit -m "feat: seed deployment es retrieval config"
```

## Task 3: Add Built-in Skill Bundle Registry

**Files:**
- Create: `server/internal/builtins/skills/types.go`
- Create: `server/internal/builtins/skills/loader.go`
- Create: `server/internal/builtins/skills/loader_test.go`
- Create: `server/internal/builtins/skills/bundles/research-skills/manifest.json`
- Create: `server/internal/builtins/skills/bundles/research-skills/<skill dirs>`

- [ ] **Step 1: Write failing loader tests**

```go
func TestLoadResearchSkillsBundle(t *testing.T) {
    reg, err := Load()
    if err != nil {
        t.Fatal(err)
    }
    bundle, ok := reg.Get("research-skills")
    if !ok {
        t.Fatal("missing research-skills bundle")
    }
    if got, want := len(bundle.Skills), 7; got != want {
        t.Fatalf("len(bundle.Skills) = %d, want %d", got, want)
    }
    if bundle.RequiredToolPresetIDs[0] != "es-context" {
        t.Fatalf("required preset = %v", bundle.RequiredToolPresetIDs)
    }
}
```

- [ ] **Step 2: Run test and confirm failure**

Run:

```bash
cd server && go test ./internal/builtins/skills
```

Expected: FAIL because the package and embedded assets do not exist.

- [ ] **Step 3: Implement the bundle registry**

The loader should:

- embed bundle files
- parse `manifest.json`
- validate stable IDs, version, skill keys, and presence of each `SKILL.md`
- expose `List()` and `Get(id)`

Example manifest:

```json
{
  "id": "research-skills",
  "version": "1.0.0",
  "name": "Research Skills",
  "required_tool_preset_ids": ["es-context"],
  "skills": [
    "expert-method-distiller",
    "howard-wang",
    "huang-qifan",
    "lin-yifu",
    "timothy-heath",
    "wu-xinbo",
    "zhao-minghao"
  ]
}
```

- [ ] **Step 4: Copy the current research skill assets into the bundle**

Copy the skill directories from `/Users/fuyb/Desktop/research-skills` into the
embedded bundle path, excluding `.DS_Store`, `.idea`, and `.claude-plugin`.

- [ ] **Step 5: Run tests**

Run:

```bash
cd server && go test ./internal/builtins/skills
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/internal/builtins/skills
git commit -m "feat: add built-in research skill bundle"
```

## Task 4: Materialize Built-in Bundles Into Workspace Skills

**Files:**
- Create: `server/internal/service/builtin_skills.go`
- Create: `server/internal/service/builtin_skills_test.go`
- Modify: `server/internal/handler/skill_create.go`
- Modify: `server/internal/handler/skill.go`

- [ ] **Step 1: Write failing materialization tests**

Cover:

- first materialization creates bundle skills
- repeated materialization reuses unchanged built-ins
- same-name custom skill causes explicit conflict
- supporting files are preserved

```go
func TestMaterializeBundleRejectsCustomNameConflict(t *testing.T) {
    // create custom "lin-yifu" first
    _, err := svc.MaterializeBundle(ctx, wsID, userID, "research-skills")
    if !errors.Is(err, ErrBuiltinSkillNameConflict) {
        t.Fatalf("err = %v", err)
    }
}
```

- [ ] **Step 2: Run tests and confirm failure**

Run:

```bash
cd server && go test ./internal/service -run TestMaterializeBundle
```

Expected: FAIL because the service does not exist.

- [ ] **Step 3: Implement materialization service**

Rules:

- look up all existing workspace skills once
- classify by `config.origin.type`
- reuse only matching `builtin` rows from the same bundle/skill key/version
- fail if a custom same-name skill exists
- create skills through existing `createSkillWithFilesInTx`
- store builtin origin metadata

- [ ] **Step 4: Rerun tests**

Run:

```bash
cd server && go test ./internal/service -run TestMaterializeBundle
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/internal/service server/internal/handler/skill_create.go server/internal/handler/skill.go
git commit -m "feat: materialize built-in skill bundles"
```

## Task 5: Add Tool Preset Registry and ES Context Resolver

**Files:**
- Create: `server/internal/toolpreset/types.go`
- Create: `server/internal/toolpreset/registry.go`
- Create: `server/internal/toolpreset/es_context.go`
- Create: `server/internal/toolpreset/es_context_test.go`

- [ ] **Step 1: Write failing preset tests**

```go
func TestResolveESContextPresetRequiresConfiguredProfile(t *testing.T) {
    _, err := ResolveESContext(nil)
    if !errors.Is(err, ErrPresetUnavailable) {
        t.Fatalf("err = %v", err)
    }
}

func TestResolveESContextRendersClaudeConfig(t *testing.T) {
    got, err := ResolveESContext(profile)
    if err != nil {
        t.Fatal(err)
    }
    if !bytes.Contains(got.ClaudeJSON, []byte(`"es_context"`)) {
        t.Fatalf("config = %s", got.ClaudeJSON)
    }
}
```

- [ ] **Step 2: Run tests and confirm failure**

Run:

```bash
cd server && go test ./internal/toolpreset
```

Expected: FAIL because the package does not exist.

- [ ] **Step 3: Implement the preset registry**

Design:

```go
type ResolvedPreset struct {
    ID         string
    ClaudeJSON json.RawMessage
    CodexJSON  json.RawMessage
}
```

`es-context` should:

- require a resolved retrieval profile
- render provider-specific MCP config from the persisted profile plus secret refs
- return `ErrPresetUnavailable` when no deployment default can be resolved

- [ ] **Step 4: Run tests**

Run:

```bash
cd server && go test ./internal/toolpreset
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/internal/toolpreset
git commit -m "feat: add es context tool preset"
```

## Task 6: Extend Agent Templates for Built-in Bundles and Tool Presets

**Files:**
- Modify: `server/internal/agenttmpl/types.go`
- Modify: `server/internal/agenttmpl/loader.go`
- Modify: `server/internal/agenttmpl/loader_test.go`
- Create: `server/internal/agenttmpl/templates/research-analyst.json`
- Modify: `server/internal/handler/agent_template.go`
- Modify: `server/internal/handler/agent_test.go`

- [ ] **Step 1: Write failing template loader tests**

```go
func TestLoadFromFSAcceptsBuiltinBundleAndPresetRefs(t *testing.T) {
    // assert builtin_skill_bundle_ids and tool_preset_ids survive load
}
```

- [ ] **Step 2: Write failing create-from-template tests**

Cover:

- missing `es-context` preset rejects create
- successful create materializes the bundle
- successful create attaches skills
- successful create merges MCP config onto the agent

- [ ] **Step 3: Run tests and confirm failure**

Run:

```bash
cd server && go test ./internal/agenttmpl ./internal/handler -run 'TestLoadFromFS|TestCreateAgentFromTemplate'
```

Expected: FAIL because template types and flow do not yet support bundle/preset refs.

- [ ] **Step 4: Extend template schema**

Add:

```go
BuiltinSkillBundleIDs []string `json:"builtin_skill_bundle_ids,omitempty"`
ToolPresetIDs         []string `json:"tool_preset_ids,omitempty"`
```

Add `research-analyst.json` using:

```json
{
  "slug": "research-analyst",
  "name": "Research Analyst",
  "builtin_skill_bundle_ids": ["research-skills"],
  "tool_preset_ids": ["es-context"]
}
```

- [ ] **Step 5: Update create-from-template flow**

Before agent insert:

1. resolve required presets
2. materialize required bundles
3. attach returned skill IDs
4. merge preset output into `mcp_config`

Return a clear client error if a preset is unavailable.

- [ ] **Step 6: Rerun tests**

Run:

```bash
cd server && go test ./internal/agenttmpl ./internal/handler -run 'TestLoadFromFS|TestCreateAgentFromTemplate'
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/internal/agenttmpl server/internal/handler/agent_template.go server/internal/handler/agent_test.go
git commit -m "feat: support built-in research templates"
```

## Task 7: Verify Runtime Provider Support for MCP Config

**Files:**
- Modify: `server/pkg/agent/codex.go`
- Modify: `server/pkg/agent/codex_test.go`
- Modify: `server/pkg/agent/claude_test.go`
- Possibly modify: `server/pkg/agent/agent.go`

- [ ] **Step 1: Add explicit regression tests**

Claude:

```go
func TestClaudeExecuteUsesMcpConfig(t *testing.T) {
    // assert --mcp-config is present when ExecOptions.McpConfig is set
}
```

Codex:

```go
func TestCodexExecuteUsesMcpConfigWhenSupported(t *testing.T) {
    // assert provider-specific config path or argument is emitted
}
```

- [ ] **Step 2: Run the provider tests**

Run:

```bash
cd server && go test ./pkg/agent -run 'TestClaude.*Mcp|TestCodex.*Mcp'
```

Expected:

- Claude test passes or needs only a small coverage addition.
- Codex test fails if the backend does not currently inject MCP config.

- [ ] **Step 3: Implement Codex provider support only if upstream CLI/runtime supports it**

If supported:

- add provider-specific rendering and argument/config-file handling
- block user override of the managed MCP argument, matching Claude's safety rule

If unsupported:

- keep Codex unavailable for `es-context` presets
- surface that limitation in template/preset compatibility checks
- do not claim feature parity

- [ ] **Step 4: Rerun provider tests**

Run:

```bash
cd server && go test ./pkg/agent
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/pkg/agent
git commit -m "feat: wire mcp presets into runtime providers"
```

## Task 8: Expose Built-in Skill Metadata to the Frontend

**Files:**
- Modify: `packages/core/types/agent.ts`
- Modify: `packages/core/types/index.ts`
- Modify: `packages/core/api/schemas.ts`
- Modify: `packages/views/skills/lib/origin.ts`
- Modify: `packages/views/skills/components/skill-columns.tsx`
- Modify: `packages/views/skills/components/skill-detail-page.tsx`
- Modify: localized skills strings
- Test: add/update Vitest coverage near the touched components

- [ ] **Step 1: Write failing frontend tests**

Cover:

- `readOrigin()` recognizes `builtin`
- built-in skill row renders a built-in label
- built-in detail page hides direct edit affordances and shows duplicate action

- [ ] **Step 2: Run targeted tests**

Run:

```bash
pnpm --filter @multica/views exec vitest run skills
```

Expected: FAIL because `builtin` origin is unknown and UI still treats the skill as editable.

- [ ] **Step 3: Extend types and schema parsing**

Add builtin origin support:

```ts
export type OriginInfo =
  | { type: "builtin"; bundle_id: string; bundle_version: string; skill_key: string }
  | { type: "runtime_local"; ... }
  | ...
```

Ensure API schema parsing treats malformed builtin metadata defensively.

- [ ] **Step 4: Update skill UI**

Behavior:

- list shows source = built-in
- detail sidebar shows bundle/version
- direct edit controls are disabled/hidden for builtin skills
- duplicate action is exposed for customization

- [ ] **Step 5: Rerun tests**

Run:

```bash
pnpm --filter @multica/views exec vitest run skills
pnpm --filter @multica/core exec vitest run api
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core packages/views
git commit -m "feat: display built-in skill metadata"
```

## Task 9: Surface Research Template Availability in the Agent UI

**Files:**
- Modify: `packages/core/types/agent.ts`
- Modify: `packages/core/api/schemas.ts`
- Modify: `packages/views/agents/components/create-agent-dialog.tsx`
- Modify: `packages/views/agents/components/create-agent-dialog.test.tsx`
- Modify: localized agent strings

- [ ] **Step 1: Write failing tests**

Cover:

- template payload includes built-in bundle and preset metadata
- unavailable preset renders disabled state with a concrete reason
- available preset allows research template selection

- [ ] **Step 2: Run targeted tests**

Run:

```bash
pnpm --filter @multica/views exec vitest run agents/components/create-agent-dialog.test.tsx
```

Expected: FAIL because the UI has no notion of required presets.

- [ ] **Step 3: Extend template response types**

Add fields such as:

```ts
required_tool_presets?: Array<{
  id: string;
  configured: boolean;
  unavailable_reason?: string;
}>;
builtin_skill_bundles?: Array<{
  id: string;
  name: string;
  version: string;
}>;
```

- [ ] **Step 4: Render template availability**

Behavior:

- show bundled research skills in template detail
- show disabled state and reason when `es-context` is not configured
- keep the rest of the create flow unchanged

- [ ] **Step 5: Rerun tests**

Run:

```bash
pnpm --filter @multica/views exec vitest run agents/components/create-agent-dialog.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core packages/views
git commit -m "feat: show research template capability status"
```

## Task 10: End-to-End Verification and Documentation

**Files:**
- Modify: docs as needed under `apps/docs/content/docs/`
- Possibly add: e2e test covering template creation and transcript assertions

- [ ] **Step 1: Add or update operator-facing documentation**

Document:

- required deployment env vars
- what `research-skills` installs
- how `es-context` differs from skill content
- v1 shared ES limitation

- [ ] **Step 2: Add an end-to-end test**

Cover:

1. configure deployment ES preset
2. create `research-analyst`
3. verify attached skills
4. run a prompt that requires current context
5. assert transcript evidence of `es_context.search_context`

- [ ] **Step 3: Run focused verification**

Run:

```bash
pnpm typecheck
pnpm test
make test
```

Expected: PASS.

- [ ] **Step 4: Run the full repo verification**

Run:

```bash
make check
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/docs e2e
git commit -m "docs: document built-in research skills"
```

## Self-Review Checklist

- Spec coverage:
  - built-in bundle registry: Tasks 3-4
  - deployment-shared ES with future workspace path: Tasks 1-2
  - tool preset abstraction: Task 5
  - research template materialization: Task 6
  - runtime execution support: Task 7
  - builtin/read-only UI: Tasks 8-9
  - docs and verification: Task 10
- Placeholder scan:
  - no `TODO`, `TBD`, or unspecified validation steps remain
- Type consistency:
  - `research-skills`
  - `es-context`
  - `default-research-context`
  - `builtin_skill_bundle_ids`
  - `tool_preset_ids`
  are used consistently throughout the plan
