# Built-in Research Skills and ES Context Design

## Summary

Multica should support the `research-skills` collection as a first-party
capability, not as a one-off imported directory. The target state is:

1. `research-skills` ships with Multica as a built-in skill bundle.
2. Research-oriented agents can use those skills immediately after creation.
3. Skills that require current factual context can call
   `es_context.search_context` at runtime through a first-party tool preset.
4. Version 1 uses one shared deployment-level Elasticsearch source, while the
   data model leaves room for workspace-specific sources later.

This design keeps three concerns separate:

- Skills describe reasoning workflows and when tools should be used.
- Tool presets describe which runtime tools an agent receives.
- Data sources and retrieval profiles describe where context comes from and how
  it is queried.

## Goals

- Ship `research-skills` as repo-owned, versioned built-in content.
- Make the bundle attachable to agents without requiring manual directory import.
- Make `es_context.search_context` genuinely available at execution time.
- Support a shared deployment-level ES backend in v1.
- Preserve a clean path to workspace-specific ES backends later.
- Reuse existing Multica primitives where possible:
  - existing `skill` and `skill_file` storage
  - existing agent template flow
  - existing `agent.mcp_config` delivery path to runtimes

## Non-goals

- General-purpose arbitrary-directory batch import in v1.
- A full admin UI for managing multiple ES clusters in v1.
- Reimplementing Elasticsearch retrieval logic inside Multica if an existing
  `es_context` MCP server already owns that concern.
- Letting users edit built-in skills in place.
- Solving workspace-specific data-source binding in v1.

## Current State

Multica already supports:

- Structured skills stored in `skill` plus supporting files.
- Runtime-local skill discovery and single-skill import from provider-specific
  roots such as `~/.claude/skills`.
- Agent templates that materialize skills from external source URLs.
- Per-agent `mcp_config`, which is carried from the API layer through the
  daemon and passed to Claude via `--mcp-config`.

Current limitations:

- There is no first-class built-in skill catalog.
- There is no arbitrary-path or directory batch import flow.
- Tool configuration exists per agent, but there is no reusable first-party
  tool preset abstraction.
- `research-skills` assumes `es_context.search_context`, but Multica does not
  currently model or provision that dependency as a built-in capability.

## Recommended Architecture

### 1. Built-in Skill Bundle

Introduce a repo-owned bundle registry for first-party skills.

Each bundle contains:

- `id`
- `version`
- display metadata
- skill directories containing `SKILL.md` and supporting files
- required tool preset IDs

For this project:

- bundle ID: `research-skills`
- contents:
  - `expert-method-distiller`
  - `howard-wang`
  - `huang-qifan`
  - `lin-yifu`
  - `timothy-heath`
  - `wu-xinbo`
  - `zhao-minghao`
- required tool preset IDs:
  - `es-context`

The bundle is loaded from the repository at server startup and treated as
read-only product content.

### 2. Workspace Materialization

Workspace-visible skills remain ordinary rows in the existing `skill` and
`skill_file` tables. Built-in bundles are materialized into those tables on
demand rather than copied into every new workspace automatically.

Materialization occurs when:

- a user creates an agent from a template requiring the bundle, or
- a future explicit "enable built-in bundle" action is invoked.

Each materialized skill stores origin metadata in `skill.config.origin`:

```json
{
  "type": "builtin",
  "bundle_id": "research-skills",
  "bundle_version": "1.0.0",
  "skill_key": "lin-yifu"
}
```

Materialization rules:

- Idempotent for an unchanged bundle version.
- Reuse existing matching built-in skills in the workspace.
- If a user-authored custom skill already uses the same name, fail with a clear
  naming-conflict error instead of overwriting or silently reusing it.
- Built-in skills are read-only in place.
- Users who need customization duplicate a built-in skill into a normal custom
  skill and edit the copy.

### 3. Tool Preset

Introduce a reusable tool preset registry for first-party runtime capabilities.

The `es-context` preset:

- exposes server name `es_context`
- exposes tool `search_context`
- resolves to one retrieval profile
- renders provider-specific MCP configuration for the agent runtime

The preset owns runtime wiring. Skills only refer to
`es_context.search_context` in their instructions.

### 4. Data Source and Retrieval Profile

Model retrieval in three layers:

```text
data_source
  -> retrieval_profile
    -> tool_preset
```

#### Data Source

Represents where data lives.

Suggested fields:

- `id`
- `scope_type`: `deployment` or `workspace`
- `scope_id`: nullable in v1
- `type`: `elasticsearch`
- `name`
- `config`
- `secret_ref`
- `enabled`

#### Retrieval Profile

Represents how a source is queried.

Suggested fields:

- `id`
- `data_source_id`
- `name`
- `index_alias`
- `field_mapping`
- `query_defaults`
- `enabled`

Examples of profile concerns:

- title field
- summary/content field
- published date field
- document ID field
- allowed indexes or aliases
- default `top_k`
- recency weighting

#### Tool Preset

Represents how a retrieval capability is exposed to agents.

Suggested fields:

- `id`
- `name`
- `server_name`
- `tools`
- `retrieval_profile_id`
- `builtin`

For v1:

- one deployment-scoped Elasticsearch data source
- one deployment-scoped default research retrieval profile
- one built-in `es-context` tool preset bound to that profile
- data sources and retrieval profiles are real persisted records from day one,
  seeded or refreshed from deployment configuration at startup

For v2:

- add workspace-scoped data sources and retrieval profiles
- resolution order becomes:
  1. workspace override
  2. deployment default

This keeps v1 simple while avoiding a schema rewrite later.

### 5. Agent Templates

Extend the built-in agent template model so templates can declare:

- built-in skill bundle IDs
- required tool preset IDs

Example conceptual template:

```json
{
  "slug": "research-analyst",
  "name": "Research Analyst",
  "builtin_skill_bundle_ids": ["research-skills"],
  "tool_preset_ids": ["es-context"]
}
```

Create-from-template flow:

1. validate required tool presets are configured
2. materialize required built-in bundles into the workspace
3. attach resulting skill IDs to the agent
4. merge required preset output into the agent's `mcp_config`
5. create the agent

If a required preset is unavailable, creation fails loudly instead of producing
an agent whose skills describe unavailable tools.

## Runtime Behavior

### Claude

Claude already accepts `agent.mcp_config` through the existing daemon flow and
uses `--mcp-config`. The `es-context` preset should render a valid Claude MCP
config payload into that existing path.

### Codex

Codex compatibility must be verified explicitly during implementation.

Required outcome:

- if Codex supports equivalent MCP configuration injection, use the same
  preset model with provider-specific rendering
- if Multica's Codex backend is missing that support, extending the backend is
  part of the implementation scope before claiming `es-context` support for
  Codex-backed agents

The design should not pretend tool parity exists until provider-level tests
prove it.

## Configuration

Version 1 should use deployment configuration rather than a full management UI.

Recommended v1 setup:

- service configuration or environment variables define the shared ES data
  source and retrieval profile
- startup seeds or refreshes the corresponding persisted deployment-scoped
  `data_source` and `retrieval_profile` records
- startup validates the preset can be resolved
- the product UI can show whether the required preset is configured, but does
  not need to provide full CRUD for sources and profiles yet

Secrets:

- ES credentials must not live in built-in skill files
- credentials should use secret references or encrypted storage, not plain
  skill content or ordinary frontend-readable JSON

## Failure Handling

### At agent creation

- If a required tool preset is not configured, reject creation with an explicit
  error.
- Do not create a partially functional research agent.

### At execution time

- Preserve the provider's original MCP startup or tool-call failure in task
  logs.
- Skills may state that purely theoretical questions can proceed without ES.
- If a question requires current context and ES is unavailable, the agent must
  say retrieval is unavailable rather than fabricating retrieved facts.

## Upgrade Strategy

- Built-in bundle version is stored with each materialized skill.
- A future bundle update can update only skills whose origin is `builtin`.
- Custom duplicated skills are never overwritten by system upgrades.
- Built-in skills stay read-only to keep upgrade semantics deterministic.

## UI Implications

### Skills

- Show built-in origin and bundle name/version.
- Render built-in skills as read-only.
- Provide "Duplicate as custom skill" for user modifications.

### Agent creation

- Research template should show bundled skills and required tool capability.
- If the preset is not configured, the template should be visibly unavailable
  with a concrete reason.

### Future admin/config UI

- v1 only needs enough status visibility to explain preset availability.
- full data-source/profile management can wait until workspace-level sources
  are introduced.

## Testing Strategy

### Backend

- bundle loader discovers all bundled skills and supporting files
- materialization is idempotent
- materialization never overwrites custom skills
- builtin origin metadata is persisted
- template creation attaches bundle skills
- template creation merges required tool presets
- missing preset configuration rejects creation
- builtin upgrade path updates only builtin skills

### Runtime

- Claude receives the rendered MCP config
- provider-specific rendering is validated
- Codex support is proven or explicitly kept unsupported until implemented

### Frontend

- built-in skills display origin and read-only state
- template UI explains preset availability
- users can duplicate a built-in skill into a custom skill

### End-to-end

- create a research agent from the built-in template
- run a prompt that loads a research skill such as `lin-yifu`
- verify transcript evidence of `es_context.search_context`

## Rollout Plan

### v1

- deployment-scoped shared ES
- built-in research bundle
- built-in `es-context` preset
- one built-in research template
- no arbitrary directory import
- no workspace-scoped ES configuration

### v2-ready follow-up

- workspace-scoped data-source and retrieval-profile bindings
- management UI for workspace-specific overrides
- preset resolution preferring workspace config over deployment defaults

## Open Implementation Questions

These should be answered during planning, not deferred until coding:

1. What exact MCP server process or remote endpoint implements
   `es_context.search_context` today?
2. Which provider runtimes besides Claude can consume equivalent MCP config
   today without additional backend work?
3. Should bundle upgrades happen automatically on first use, via an admin
   action, or through a migration/job?
4. What is the right storage mechanism for ES secret references in the current
   deployment environment?
