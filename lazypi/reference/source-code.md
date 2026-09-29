# Architecture & Source Code Deep Dive

This document details the architectural topology, extension engines, and internal protocols of the `lazypi` codebase.

---

## 1. Full System Architecture Map

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                                    lazypi Codebase                                      │
│  ├── extensions/omp-provider.ts                                                         │
│  ├── extensions/subagent/ (index.ts, agents.ts)                                         │
│  └── prompts/ (/implement, /scout-and-plan, /implement-and-review)                       │
└───────────────────────────────────────────┬─────────────────────────────────────────────┘
                                            │ Loads into
                                            ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                              Pi Coding Agent Core Runtime                               │
│                         @earendil-works/pi-coding-agent (ESM)                            │
│  • Extension runner initializes extensions with ExtensionAPI                            │
│  • In-memory registries: Tools, Slash Commands, Providers, Lifecycle Hooks               │
└───────────────────────────────┬─────────────────────────────────┬───────────────────────┘
                                │                                 │
                 CLI Surface    │                                 │ RPC Daemon Surface
                                ▼                                 ▼
┌──────────────────────────────────────────────┐  ┌──────────────────────────────────────────────┐
│           Pi CLI (Terminal / TUI)            │  │           PiChamber Server (:9999)           │
│                                              │  │                 @pi-chamber/web              │
├──────────────────────────────────────────────┤  ├──────────────────────────────────────────────┤
│ • Execution Mode: interactive / print        │  │ • Execution Mode: mode: 'rpc' (hasUI = true) │
│ • Local TTY & stdin/stdout stream            │  │ • Persistent Daemon: session-daemon.js        │
│ • UI Primitives: @earendil-works/pi-tui      │  │ • UI Bridge: extension-bridge.js             │
│   (Container, Markdown, Text, Spacer)        │  │ • Injects __PICHAMBER__ global marker        │
│ • Dialogs: curses/readline prompts           │  │ • Injects Form Modal: ctx.ui.form()          │
│ • Keybindings: pi.registerShortcut()         │  │ • Intercepts pichamber.ui & pichamber.app    │
└──────────────────────────────────────────────┘  └───────────────────────┬──────────────────────┘
                                                                          │ WebSocket / SSE Frames
                                                                          ▼
                                                  ┌──────────────────────────────────────────────┐
                                                  │       PiChamber Web / Mobile Client          │
                                                  ├──────────────────────────────────────────────┤
                                                  │ • Interactive Cards: Table, Progress, MD     │
                                                  │ • Native Form Modals with Field Validation   │
                                                  │ • Sandboxed HTML iFrames (pichamber.app)     │
                                                  │ • Normalized Header Statuses & Widget Banners│
                                                  └──────────────────────────────────────────────┘
```

---

## 2. Dynamic Gateway Provider (`extensions/omp-provider.ts`)

`omp-provider.ts` dynamically aggregates upstream models from local LLM proxies into a single root provider: `"nexus"`.

### Initialization & Probe Sequence
When loaded by `pi`:
1. **Probe NexusRoute (`:4010`)**: Attempts `fetch("http://127.0.0.1:4010/v1/models", { signal: AbortSignal.timeout(1500) })`. If active, models route through `:4010` (enabling prompt intercept, caching, and edge routing).
2. **Fallback to OMP Gateway (`:4000`)**: If `:4010` times out or fails, queries `http://127.0.0.1:4000/v1/models` (1500ms timeout).
3. **Failover to Disk Snapshot**: If both gateways are unreachable (e.g. services stopped in `sdm`), reads cached models from:
   `~/.cache/pichamber/nexus-models-snapshot.json` (or `$XDG_CACHE_HOME/pichamber/...`).
4. **Snapshot Persistence**: When an online probe succeeds, writes the raw `/v1/models` JSON payload to the disk snapshot for zero-downtime subsequent startups.

### Local Catalog Enrichment
`omp-provider.ts` scans local JSON catalog files to enrich raw models with context limits, thinking levels, and pricing:
```ts
const OMP_CATALOG_PATHS = [
  join(homedir(), "library/repos/oh-my-pi/packages/catalog/src/models.json"),
  join(homedir(), ".omp/catalog/models.json"),
  join(homedir(), ".9router/model-catalog.json"),
];
```

### Model Normalization & Display Badging
- **Model ID Normalization**: Upstream model IDs are mapped to the format:
  `nexus/<upstream-provider>/<raw-model-id>`  
  *(e.g. `nexus/google-antigravity/gemini-3.8-flash`, `nexus/openrouter/deepseek/deepseek-chat`)*
- **Provider Badging**: Adds readable terminal/web badges to model names:
  - `google-antigravity` ➔ `[antigravity]`
  - `openrouter` ➔ `[openrouter]`
  - `opencode-zen` ➔ `[zen]`
  - `ollama-cloud` ➔ `[ollama-cloud]`
- **Provider Registration**:
  Registers with Pi via `pi.registerProvider("nexus", { baseUrl, apiKey, models, streamSimple })`.

---

## 3. Subagent Engine (`extensions/subagent/`)

The subagent subsystem allows a parent Pi session to delegate specialized tasks to isolated sub-agents without context window pollution.

### Agent Discovery (`agents.ts`)
`discoverAgents(cwd, scope)` scans two tiers of directories:
1. **User Scope**: `~/.pi/agent/agents/*.md` (global agents like `scout.md`, `planner.md`, `builder.md`, `reviewer.md`).
2. **Project Scope**: Nearest `.pi/agents/*.md` relative to the active workspace `cwd`.
3. **YAML Frontmatter Parsing**: Parses markdown files using `parseFrontmatter`. Normalizes the `tools` field whether defined as a comma-separated string (`tools: read, bash`) or a YAML list (`tools: [read, bash]`). A corrupted agent file is skipped gracefully without halting discovery.

### Process Spawning & Invocation (`index.ts`)
Each subagent executes in a completely separate CLI process spawned via `node:child_process`:
- **Executable Resolution (`getPiInvocation`)**: Resolves `bun`, `node`, or the standalone `pi` binary, handling Bun virtual filesystem prefixes (`/$bunfs/root/`).
- **CLI Arguments**:
  ```bash
  pi --mode json -p --no-session --no-skills --no-prompt-templates \
     --append-system-prompt "<agent-system-prompt>" \
     --tools "<comma-separated-tools>" \
     [--model "<agent-model>"] \
     "<task-prompt>"
  ```
- **Stateless Isolation**:
  - `--mode json`: Streams NDJSON events (`message_start`, `tool_execution_start`, `turn_end`) for real-time progress parsing.
  - `-p` (Print/Non-interactive): Processes the prompt and exits immediately.
  - `--no-session`: Ephemeral execution; leaves no JSONL session history files.
  - `--no-skills --no-prompt-templates`: Eliminates startup overhead.

### Execution Modes & Concurrency Control
`extensions/subagent/index.ts` supports three distinct execution modes:
1. **Single Mode**: `{ agent: "scout", task: "..." }`
2. **Parallel Mode**: `{ tasks: [{ agent: "scout", task: "..." }, ...] }`
   - Governed by `mapWithConcurrencyLimit`.
   - `MAX_PARALLEL_TASKS = 8`, `MAX_CONCURRENCY = 4`.
   - Processes tasks in bounded batches to avoid CPU/memory starvation.
3. **Chain Mode**: `{ chain: [{ agent: "scout", task: "..." }, { agent: "planner", task: "... {previous} ..." }] }`
   - Runs sequentially.
   - Automatically replaces `{previous}` tokens in step $N$ with the trimmed stdout of step $N-1$.

### Buffer Management & Cleanup
- **Output Truncation**: Capped at `PER_TASK_OUTPUT_CAP = 50 * 1024` (50 KB) to prevent memory leaks from massive command outputs.
- **Process Cancellation**: Listens to the `AbortSignal` passed by Pi's tool execution framework. If aborted, invokes `child.kill("SIGTERM")` followed by `SIGKILL` after a grace period.

---

## 4. PiChamber Extension Protocols (`pichamber-extension-ui`)

When running inside PiChamber, extensions can leverage rich UI protocols:

### Interactive UI Cards (`pichamber.ui`)
Emitted via `pi.appendEntry`:
```ts
pi.appendEntry("pichamber.ui", {
  protocol: "pichamber-extension-ui",
  version: 1,
  id: "subagent-status-panel", // Replaces existing card with same ID in-place
  title: "Active Subagents",
  component: "table", // Supported: 'table', 'markdown', 'progress'
  props: {
    columns: ["Agent", "Status", "Task"],
    rows: [["scout", "running", "Inspect codebase"]],
  },
  actions: [
    { label: "Cancel All", command: "subagent-cancel", variant: "destructive" },
  ],
});
```

### Sandboxed App Surfaces (`pichamber.app`)
Renders an isolated iframe surface (max 70 KB HTML):
```ts
pi.appendEntry("pichamber.app", {
  protocol: "pichamber-extension-ui",
  version: 1,
  appId: "dashboard",
  title: "Subagent Dashboard",
  html: `
    <!doctype html>
    <html>
      <body>
        <button data-pichamber-command="subagent-status">Refresh</button>
      </body>
    </html>
  `,
});
```
*Buttons with `data-pichamber-command` dispatch authenticated slash commands through PiChamber's prompt pipeline.*

### Multi-field Form Dialogs (`ctx.ui.form`)
PiChamber injects `ctx.ui.form` for structured modal input:
```ts
if (typeof (ctx.ui as any).form === "function") {
  const values = await (ctx.ui as any).form("Configure Subagent", [
    { id: "agent", label: "Agent", type: "select", options: ["scout", "builder"] },
    { id: "task", label: "Task Description", type: "textarea", required: true },
  ]);
}
```
