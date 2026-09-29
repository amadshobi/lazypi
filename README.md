# lazypi

Zero-build extension bundle, unified multi-provider gateway connector, and context-isolated subagent delegation suite for [Pi Coding Agent](https://pi.dev) and [PiChamber](https://github.com/RyderAsKing/PiChamber).

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Runtime: Bun / Node 22+](https://img.shields.io/badge/Runtime-Bun%20%7C%20Node%2022%2B-f9f1e1)](https://bun.sh)

---

## Overview

`lazypi` bridges local LLM gateways and adds multi-agent orchestration to both **Pi CLI (Terminal TUI)** and **PiChamber (WebUI `:9999`)** without requiring a build step.

### Key Features

- **Unified `nexus` Gateway Provider (`extensions/omp-provider.ts`)**
  - Probes NexusRoute (`:4010`) and falls back to Oh-My-Pi Auth Gateway (`:4000`) or disk snapshot cache (`~/.cache/pichamber/nexus-models-snapshot.json`) for zero-downtime startup.
  - Registers all upstream models under the `nexus/<provider>/<model>` namespace with provider badges (`[antigravity]`, `[openrouter]`, `[ollama-cloud]`, `[opencode-zen]`).
  - Enriches context windows, max output tokens, reasoning flags, and pricing from local OMP catalogs with `O(1)` indexed lookups.
  - Includes `/nexus-reload` slash command for live catalog refresh without restarting Pi.
- **Hybrid Subagent Delegation Engine (`extensions/subagent/`)**
  - Spawns isolated child `pi` processes in **single**, **parallel** (up to 8 tasks, concurrency 4), or **chain** (`{previous}` placeholder) modes.
  - Supports reusable subagent IDs (`sub_<agent>_<shortId>`) backed by isolated session files (`~/.cache/lazypi/subagents/<id>.jsonl`) for multi-turn follow-ups.
  - Dual-surface rendering: interactive `@earendil-works/pi-tui` widgets + `Ctrl+Alt+S` inspector in Pi CLI, and native reactive cards + sandboxed HTML mini-app inspector (`/subagent-inspect`) in PiChamber WebUI.
- **Editor JSON Schemas (`schemas/`)**
  - Draft-07 JSON Schemas for `~/.pi/agent/settings.json` and `~/.pi/agent/models.json` providing full LSP autocomplete and validation in Neovim (`jsonls`) and VS Code.
- **Engineering Skill (`lazypi/SKILL.md`)**
  - Dual-runtime architecture reference covering Pi CLI and PiChamber RPC synchronization contracts.

---

## Installation

### Prerequisites

- [Pi Coding Agent](https://pi.dev) (`@earendil-works/pi-coding-agent` v0.85+)
- [Bun](https://bun.sh) v1.2+ or Node.js v22+
- Optional: Local [Oh-My-Pi](https://github.com/amadshobi/oh-my-pi) gateway (`:4000`) or NexusRoute (`:4010`)

### Install Package

Install directly from GitHub:

```bash
pi install git:github.com/amadshobi/lazypi
```

Or install from a local clone:

```bash
git clone https://github.com/amadshobi/lazypi.git ~/projects/lazypi
pi install ~/projects/lazypi
```

Verify installation:

```bash
pi list
```

---

## Usage

### 1. Using `nexus` Gateway Models

List available models discovered from your local gateway or snapshot cache:

```bash
pi --list-models nexus
```

Refresh the model catalog at any time inside an active session:

```text
/nexus-reload
```

### 2. Delegating Tasks to Subagents

The `subagent` tool supports three execution modes and session resumption:

```json
// Single subagent task
{
  "agent": "scout",
  "task": "Find all authentication middleware routes"
}

// Resume a previous subagent session by ID
{
  "agent": "scout",
  "id": "sub_scout_a1b2c3",
  "task": "Now inspect rate limiting on those routes"
}

// Parallel execution (bounded concurrency: 4, max: 8)
{
  "tasks": [
    { "agent": "scout", "task": "Audit database schema in src/db" },
    { "agent": "scout", "task": "Audit API handlers in src/routes" }
  ]
}

// Chained execution with {previous} substitution
{
  "chain": [
    { "agent": "scout", "task": "Locate session timeout configuration" },
    { "agent": "planner", "task": "Design a keep-alive heartbeat based on: {previous}" },
    { "agent": "builder", "task": "Implement the plan: {previous}" }
  ]
}
```

Inspect subagent runs interactively:

```text
/subagent-inspect
/subagent-inspect sub_scout_a1b2c3
```

---

## Configuration

### Gateway Endpoints & Cache

| Resource | Default Location / Endpoint | Description |
| :--- | :--- | :--- |
| **NexusRoute** | `http://127.0.0.1:4010/v1/models` | Primary gateway probe (1500ms timeout) |
| **OMP Gateway** | `http://127.0.0.1:4000/v1/models` | Fallback gateway probe (3500ms timeout) |
| **Snapshot Cache** | `~/.cache/pichamber/nexus-models-snapshot.json` | Offline model catalog snapshot (`XDG_CACHE_HOME` respected) |
| **Subagent Sessions** | `~/.cache/lazypi/subagents/<id>.jsonl` | Isolated persistent transcripts for reusable subagent IDs |

### Editor Autocomplete (`jsonls` / VS Code)

Reference the bundled schemas in `~/.pi/agent/settings.json`:

```json
{
  "$schema": "https://raw.githubusercontent.com/amadshobi/lazypi/main/schemas/settings.schema.json"
}
```

And in `~/.pi/agent/models.json`:

```json
{
  "$schema": "https://raw.githubusercontent.com/amadshobi/lazypi/main/schemas/models.schema.json",
  "providers": {}
}
```

---

## Development

`lazypi` is a zero-bundler TypeScript package executed natively by Pi's runtime.

```bash
# 1. Verify TypeScript syntax & transpilation
bun build --no-bundle --outdir /tmp extensions/omp-provider.ts extensions/subagent/index.ts

# 2. Smoke test provider model registration
pi -e ./extensions/omp-provider.ts --list-models nexus

# 3. Smoke test subagent extension loading
pi -e ./extensions/subagent/index.ts -p "ping" --no-session

# 4. Validate Draft-07 JSON schemas
bun -e 'JSON.parse(await Bun.file("schemas/settings.schema.json").text())'
bun -e 'JSON.parse(await Bun.file("schemas/models.schema.json").text())'
```

---

## Documentation

- [Repository & Architecture Guidelines (`AGENTS.md`)](./AGENTS.md)
- [Dual-Runtime Engineering Skill (`lazypi/SKILL.md`)](./lazypi/SKILL.md)
  - [Setup & Build Reference](./lazypi/reference/build.md)
  - [Source Code & Protocol Internals](./lazypi/reference/source-code.md)
  - [Troubleshooting Runbook](./lazypi/reference/troubleshooting.md)

---

## License

MIT © [amadshobi](https://github.com/amadshobi)
