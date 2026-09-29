# Build, Configuration & Dual-Runtime Setup

This guide details package wiring, schema integration, dual-runtime version constraints, and development commands for `lazypi`.

---

## 1. Package Manifest & Autoloading

`lazypi` is a zero-build Pi package. Its runtime configuration is declared in `projects/lazypi/package.json`:

```json
{
  "name": "lazypi",
  "version": "0.1.0",
  "description": "A lazy, batteries-included extension bundle & prompt suite for Pi Coding Agent",
  "keywords": ["pi-package"],
  "license": "MIT",
  "pi": {
    "prompts": ["prompts"],
    "extensions": ["extensions"]
  }
}
```

### Installation into Pi Environments
To install and autoload `lazypi` into Pi (both CLI and PiChamber daemon):
```bash
# Local development link
pi install ~/projects/lazypi

# From Git repository
pi install git:github.com/amadshobi/lazypi

# Verify installed packages
pi list
```
When installed via `pi install`, Pi automatically records the package path in `~/.pi/agent/settings.json` under `"packages"`.

---

## 2. Editor Schema Integration (Draft-07)

`lazypi` provides complete JSON Schema Draft-07 files under `schemas/` for autocomplete, validation, and hover docs in Neovim (`jsonls`) and VS Code:

- `schemas/settings.schema.json` (52 properties for `~/.pi/agent/settings.json`)
- `schemas/models.schema.json` (22 provider compatibility features for `~/.pi/agent/models.json`)

### Neovim Autocomplete Configuration
In `~/.pi/agent/settings.json`:
```json
{
  "$schema": "../../projects/lazypi/schemas/settings.schema.json"
}
```

In `~/.pi/agent/models.json`:
```json
{
  "$schema": "../../projects/lazypi/schemas/models.schema.json",
  "providers": {}
}
```

---

## 3. Dual-Runtime Version Constraints & Pinning

A critical engineering constraint across the workstation is the version divergence between CLI and WebUI:

| Runtime Surface | Host Process | Package Dependency | Pinned Version |
| :--- | :--- | :--- | :--- |
| **Pi CLI** | Direct binary (`~/.bun/bin/pi`) | `@earendil-works/pi-coding-agent` | `^0.85.1` (Current: `0.86.0`) |
| **PiChamber Server** | Daemon (`pichamber.service`) | `@pi-chamber/web` ➔ `@earendil-works/pi-coding-agent` | **`0.85.1` (Strictly Pinned)** |

### Rules for Cross-Version Compatibility:
1. **No Breaking SDK Imports**: In `0.86.0`, provider stream inputs changed from `Context` to `TranscriptContext`. Extensions authored in `lazypi` must avoid relying on 0.86.0-exclusive types or stream signatures that fail when loaded by the PiChamber 0.85.1 runtime.
2. **ESM Imports**: Always use pure ES module syntax with explicit `.ts` extensions for local files (`import { discoverAgents } from "./agents.ts"`).
3. **Pure Node Built-ins**: Use the `node:` protocol prefix (`node:fs`, `node:child_process`, `node:path`, `node:os`) for runtime neutrality across Node.js v22+ and Bun v1.2+.

---

## 4. Service Ecosystem & Port Matrix

`lazypi` coordinates with the local AI gateway and UI services running under `sdm` (Systemd Manager):

| Service | Port | Protocol / Purpose | Systemd Unit |
| :--- | :--- | :--- | :--- |
| **PiChamber WebUI** | `9999` | HTTP / WebSocket UI & Remote Tailscale Gateway | `pichamber.service` |
| **NexusRoute Edge** | `4010` | Fast local proxy, model caching & telemetry | `nexus-gateway.service` |
| **OMP Auth-Gateway**| `4000` | Oh-My-Pi upstream authentication proxy | `omp-gateway.service` |
| **OMP Auth-Broker** | `4001` | Vault daemon for OAuth / credential refresh | `omp-broker.service` |

### Service Management Commands
```bash
# Check status of all workstation services
sdm ls

# Restart NexusRoute or OMP Gateway
sdm r nexus-gateway
sdm r omp-gateway

# Inspect live logs
sdm l nexus-gateway
sdm l pichamber
```

---

## 5. Development & Verification Commands

Because `lazypi` is a zero-build project executed natively by Pi's TypeScript runtime, verify changes using Bun:

```bash
cd /home/shobixlinuxdev/projects/lazypi

# 1. Syntax & Transpilation Verification (Must specify --outdir when compiling multiple files)
bun build --no-bundle --outdir /tmp extensions/omp-provider.ts extensions/subagent/index.ts

# 2. Verify JSON Schema Integrity
bun -e 'JSON.parse(await Bun.file("schemas/settings.schema.json").text())'
bun -e 'JSON.parse(await Bun.file("schemas/models.schema.json").text())'

# 3. Provider Smoke Test (Direct invocation)
pi -e ./extensions/omp-provider.ts --list-models nexus

# 4. Subagent Smoke Test (Non-interactive mode)
pi -e ./extensions/subagent/index.ts -p "ping" --no-session
```
