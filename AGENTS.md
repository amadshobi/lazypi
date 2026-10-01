# Repository Guidelines

## Project Overview
`lazypi` is a lightweight, zero-build extension bundle, multi-provider gateway connector, and multi-agent workflow suite for [Pi Coding Agent](https://pi.dev) and [PiChamber](https://github.com/RyderAsKing/PiChamber).

### Core Components
- **Unified Gateway Routing (`extensions/omp-provider.ts`)**: Bridges local Oh-My-Pi (`:4000`) and NexusRoute (`:4010`) LLM gateways into a single `nexus` provider with enriched metadata, pricing, context windows, and disk snapshot fallback.
- **Context-Isolated Subagent Delegation (`extensions/subagent/`)**: Registers the `subagent` tool for single, parallel (max 8 tasks, concurrency 4), and chained execution with `{previous}` output replacement.
- **Agent Manager (`extensions/agent-manager.ts`)**: Session-level primary persona switcher (`/agent-select`, `<agent_switch name="..." />`), prompt swapping, global context pruning (`stripGlobalContext`), and dynamic tool filtering (`pi.setActiveTools`).
- **Interactive Question Tool (`extensions/question.ts`)**: Hybrid dual-surface tool. Renders interactive menu + inline text `Editor` in CLI TUI, and triggers native modal dialogs (`ctx.ui.select` & `ctx.ui.input`) in PiChamber WebUI (`rpc`).
- **Workflow Prompts (`prompts/`)**: Slash command pipelines (`/implement`, `/scout-and-plan`, `/implement-and-review`).
- **Editor Schemas (`schemas/`)**: JSON Schemas for `settings.json`, `models.json`, and `agents.json`.

---

## Architecture & Data Flow

```
Pi Runtime (pi / omp / PiChamber daemon)
  │
  ├──► Extensions Loader (via package.json "pi.extensions")
  │     ├──► omp-provider.ts      ➔ Probe :4010 ➔ :4000 ➔ ~/.cache/pichamber/nexus-models-snapshot.json
  │     ├──► subagent/index.ts    ➔ Spawns child `pi` processes in JSON mode (--no-session --no-skills)
  │     ├──► agent-manager.ts     ➔ Swaps APPEND_SYSTEM.md persona & enforces agent tools/skills
  │     └──► question.ts          ➔ TUI (ctx.ui.custom) vs PiChamber WebUI (ctx.ui.select / ctx.ui.input)
  │
  └──► Prompts Loader: /implement, /scout-and-plan, /implement-and-review
```

---

## Critical Development & Verification Commands

`lazypi` is a **zero-build** project executed directly by Pi's TypeScript runtime. Do not introduce bundlers (Vite/Rollup/tsup). Dependencies (`@earendil-works/pi-*`, `typebox`) are resolved in the host Pi environment.

```bash
# Transpilation & Syntax Check (All extensions)
bun build --no-bundle --outdir /tmp \
  extensions/omp-provider.ts \
  extensions/subagent/index.ts \
  extensions/agent-manager.ts \
  extensions/question.ts

# JSON Schemas Validation
bun -e '
  for (const f of ["schemas/settings.schema.json", "schemas/models.schema.json", "schemas/agents.schema.json"]) {
    JSON.parse(await Bun.file(f).text());
  }
  console.log("All schemas valid JSON");
'

# Smoke Tests in Pi CLI
pi -e ./extensions/omp-provider.ts --list-models nexus
pi -e ./extensions/subagent/index.ts -p "ping" --no-session
```

---

## Code & Runtime Conventions

1. **Imports**: Always use explicit Node protocol for built-ins: `node:fs`, `node:child_process`, `node:os`, `node:path`.
2. **ESM Only**: Extensions export a default async function:
   ```ts
   import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
   export default function (pi: ExtensionAPI): void { ... }
   ```
3. **Dual-Surface Compatibility (CLI vs PiChamber)**:
   - Check environment before using TUI primitives:
     ```ts
     const isPiChamber = ctx.mode === "rpc" && ctx.hasUI === true;
     ```
   - In Pi CLI (`ctx.mode === "tui"`), use `@earendil-works/pi-tui` and `ctx.ui.custom`.
   - In PiChamber WebUI (`rpc`), TUI frames are intentionally no-ops; use `ctx.ui.select()`, `ctx.ui.input()`, or emit `pichamber.ui` / `pichamber.app` cards via `pi.appendEntry()`.
4. **Tool Registration & Safety**:
   - Parameter schemas MUST be declared using `Type` from `typebox`.
   - Never throw unhandled exceptions in tool execution or lifecycle hooks; return an error string or fallback state gracefully.
   - Respect concurrency bounds: child processes must be throttled and listen to `AbortSignal`.
