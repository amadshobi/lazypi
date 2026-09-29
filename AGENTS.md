# Repository Guidelines

## Project Overview
`lazypi` is a lightweight, zero-build extension bundle, multi-provider gateway connector, and agent delegation workflow suite for [Pi Coding Agent](https://pi.dev) and [PiChamber](https://github.com/RyderAsKing/PiChamber).

Its core functions:
- **Unified Gateway Routing (`extensions/omp-provider.ts`)**: Bridges local Oh-My-Pi (`:4000`) and NexusRoute (`:4010`) LLM gateways into a single `nexus` provider with enriched metadata (pricing, context windows, thinking tiers).
- **Context-Isolated Subagent Delegation (`extensions/subagent/`)**: Registers the `subagent` tool to spawn stateless child `pi` processes in single, parallel (concurrency 4, max 8), or chained modes with `{previous}` output substitution.
- **Workflow Automation (`prompts/`)**: Pre-configured slash command workflows (`/implement`, `/scout-and-plan`, `/implement-and-review`).
- **Configuration Schemas (`schemas/`)**: JSON Schema Draft-07 definitions for editor autocomplete in `~/.pi/agent/settings.json` and `models.json`.

---

## Architecture & Data Flow

```
Pi Runtime (pi / omp)
  │
  ├──► Extensions Loader
  │     ├──► omp-provider.ts
  │     │     ├── Probe :4010 (NexusRoute) ➔ Fallback :4000 (OMP Gateway) ➔ Fallback Snapshot Cache
  │     │     ├── Enrich metadata via local OMP catalogs (models.json)
  │     │     └── Register provider: "nexus" (Model IDs: "nexus/<upstream>/<model>")
  │     │
  │     └──► subagent/index.ts
  │           ├── discoverAgents() [agents.ts] scans ~/.pi/agent/agents/ & .pi/agents/
  │           ├── Register tool: "subagent" (TypeBox schema)
  │           └── Execution Engine (spawns isolated `pi` CLI in JSON mode):
  │                 • Single    ➔ 1 subagent execution
  │                 • Parallel  ➔ Bounded pool (max 8 tasks, concurrency 4)
  │                 • Chain     ➔ Sequential steps substituting `{previous}`
  │
  └──► Prompts Loader: registers /implement, /scout-and-plan, /implement-and-review
```

### Data Flow Details
1. **Provider Resolution**: On startup, `omp-provider.ts` queries `http://127.0.0.1:4010/v1/models` (1500ms timeout) then `http://127.0.0.1:4000/v1/models`. If online, it updates the disk snapshot cache (`~/.cache/pichamber/nexus-models-snapshot.json`). If offline or services are stopped, it gracefully falls back to the cached snapshot without failing startup.
2. **Subagent Execution**: Subagents run stateless (`--no-session --no-skills --no-prompt-templates --mode json -p`). Standard output streams JSON messages parsed in real time into interactive `@earendil-works/pi-tui` components. Task output is capped at 50 KB (`PER_TASK_OUTPUT_CAP`) to prevent memory leaks.

---

## Key Directories

- `extensions/`: Pure ESM TypeScript extensions loaded directly by Pi.
  - `extensions/omp-provider.ts`: Unified Nexus/OMP model gateway extension and dynamic model registration.
  - `extensions/subagent/`: Autonomous subagent delegation engine.
    - `extensions/subagent/index.ts`: Tool registration, process spawning, concurrency limit, and TUI rendering.
    - `extensions/subagent/agents.ts`: Agent discovery and YAML frontmatter parsing.
- `prompts/`: Built-in workflow prompt templates (`.md`) exposed as slash commands.
  - `prompts/implement.md`: Chain: scout ➔ planner ➔ builder.
  - `prompts/implement-and-review.md`: Chain: builder ➔ reviewer ➔ builder.
  - `prompts/scout-and-plan.md`: Chain: scout ➔ planner.
- `schemas/`: Draft-07 JSON Schemas for LSP / editor integration.
  - `schemas/models.schema.json`: Schema for `~/.pi/agent/models.json`.
  - `schemas/settings.schema.json`: Schema for `~/.pi/agent/settings.json`.

---

## Development Commands

`lazypi` is a zero-build project executed directly by Pi's TypeScript runtime.

```bash
# Syntax and Transpilation Verification (Bun)
bun build --no-bundle --outdir /tmp extensions/omp-provider.ts extensions/subagent/index.ts

# Smoke Test: Verify Provider Registration
pi -e ./extensions/omp-provider.ts --list-models nexus

# Smoke Test: Verify Subagent Tool Loading
pi -e ./extensions/subagent/index.ts -p "ping" --no-session

# Validate JSON Schemas
bun -e 'JSON.parse(await Bun.file("schemas/settings.schema.json").text())'
bun -e 'JSON.parse(await Bun.file("schemas/models.schema.json").text())'

# Local Package Installation / Autoloading
pi install .
pi list
```

---

## Code Conventions & Common Patterns

- **Runtime Imports**: Always use the explicit `node:` protocol for built-ins (`node:fs`, `node:child_process`, `node:os`, `node:path`).
- **Pure ESM**: Use ES module syntax (`import`/`export`), default export extension entrypoints:
  ```ts
  import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
  export default async function (pi: ExtensionAPI): Promise<void> { ... }
  ```
- **Fail-Safe Fallbacks**: Never throw unhandled exceptions in extension lifecycle hooks. Fall back gracefully to cache or skip invalid configurations (e.g., unreachable gateway -> disk snapshot; malformed agent markdown -> skip file).
- **Concurrency & Resource Limits**:
  - Always enforce bounded concurrency when spawning child tasks (`MAX_CONCURRENCY = 4`, `MAX_PARALLEL_TASKS = 8`).
  - Cap child process buffer captures (`PER_TASK_OUTPUT_CAP = 50 * 1024`).
  - Propagate `AbortSignal` to terminate child processes cleanly on cancellation.
- **TypeBox Schemas**: Declare Pi tool parameter schemas using `Type` from `typebox`:
  ```ts
  parameters: Type.Object({
    agent: Type.Optional(Type.String({ description: "..." })),
    task: Type.Optional(Type.String({ description: "..." })),
  })
  ```
- **TUI Consistency**: Use `@earendil-works/pi-tui` primitives (`Container`, `Text`, `Markdown`, `Spacer`) for interactive terminal rendering.

---

## Important Files

- `package.json`: Pi package manifest. Declares extensions and prompts autoload paths:
  ```json
  "pi": { "extensions": ["extensions"], "prompts": ["prompts"] }
  ```
- `extensions/omp-provider.ts`: Manages dynamic model registration under `nexus/` prefix, catalog lookup, and disk snapshots.
- `extensions/subagent/index.ts`: Core subagent tool handler, process invocation (`getPiInvocation`), and concurrency control.
- `extensions/subagent/agents.ts`: Resolves user agents (`~/.pi/agent/agents/*.md`) and project agents (`.pi/agents/*.md`).
- `schemas/settings.schema.json`: Complete settings schema with 52 properties for autocomplete.
- `schemas/models.schema.json`: Models configuration schema with 22 provider compatibility definitions.

---

## Runtime & Tooling Preferences

- **Runtime**: Bun (`v1.2+`) or Node.js (`v22+`). Bun is preferred for local syntax checks and script execution.
- **Package Management**: No runtime dependencies are bundled in `node_modules` inside this repo. Dependencies are resolved by the parent Pi agent environment (`@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`, `typebox`).
- **Zero-Bundler**: Do **not** introduce build tools (Vite, Rollup, Webpack, tsup). Pi loads TypeScript files natively.

---

## Testing & QA

There is currently no dedicated unit test runner configured. Follow this manual QA and verification procedure before committing changes:

1. **Syntax Check**: Run `bun build --no-bundle --outdir /tmp extensions/omp-provider.ts extensions/subagent/index.ts` to catch syntax or import errors.
2. **Provider Verification**:
   - Start local gateway (e.g. `sdm r nexus-gateway` or `sdm r omp-gateway`).
   - Run `pi --list-models nexus` and confirm models display with provider badges (`[antigravity]`, `[openrouter]`).
   - Test offline resilience: stop gateways and re-run to confirm fallback snapshot loading works.
3. **Subagent Execution**:
   - Verify single task: delegate a simple read task to `scout`.
   - Verify chain task: test `{previous}` parameter substitution between two steps.
   - Verify cancellation: interrupt a subagent run (Ctrl+C) and ensure child processes terminate cleanly.
4. **Schema Integrity**: Ensure JSON schemas remain parseable by `jsonls` without trailing commas or broken `$ref` links.
