---
name: lazypi
description: "CRITICAL: MUST LOAD when developing, debugging, extending, or maintaining the lazypi package, its dual-runtime integration across Pi CLI (Terminal/TUI) and PiChamber (WebUI :9999), omp-provider gateway bridge, and subagent delegation workflows."
---

# lazypi Engineering & Dual-Runtime Architecture

This skill provides mandatory architectural doctrine, runtime adaptation contracts, and operational runbooks for developing, configuring, and troubleshooting the `lazypi` package across both **Pi CLI (Terminal/TUI)** and **PiChamber (WebUI / Remote Gateway)** environments.

---

## ⚠️ CRITICAL DOCTRINE & SYNCHRONIZATION WARNING

> **Core Doctrine:**  
> **"PiChamber adapts to Pi, never the reverse."**  
> Pi (`@earendil-works/pi-coding-agent`) is the authoritative runtime engine. PiChamber (`@pi-chamber/web`) is a supervisory daemon that wraps Pi sessions in `mode: 'rpc'` and bridges events over WebSockets to web/mobile surfaces.

### The React UI vs. Terminal TUI Synchronization Trap
- **The Divergence:** Pi CLI renders interactive widgets using `@earendil-works/pi-tui` (`Container`, `Markdown`, `Text`, ANSI escape codes). PiChamber **does not convert TUI terminal escape sequences into React components**. In PiChamber, pure terminal TUI components dump raw, unformatted ASCII text into the chat transcript.
- **The Protocol Gap:** PiChamber supports rich native cards (`component: 'table'`, `component: 'markdown'`, `component: 'progress'`) and multi-input dialogs (`ctx.ui.form()`) via its custom `pichamber-extension-ui` protocol (`pi.appendEntry('pichamber.ui', ...)`). However, **plain Pi CLI does not implement `ctx.ui.form` or native web cards**. Calling `ctx.ui.form()` in the CLI will throw an `undefined is not a function` error.
- **The Golden Rule:** Every extension authored or modified in `lazypi` **MUST** implement dual-surface checks. Never assume terminal escape sequences render on the Web, and never invoke WebUI-only APIs without a graceful CLI fallback!

---

## Runtime Environment Detection

Use this exact, battle-tested detection helper to branch between PiChamber WebUI and plain Pi CLI:

```ts
/**
 * Detects whether the extension is executing inside a PiChamber daemon session.
 */
export const isPiChamber = (ctx: { mode: string; hasUI: boolean }): boolean => {
  // 1. Check frozen, versioned global marker injected by PiChamber session daemon
  const marker = (globalThis as unknown as Record<string, unknown>).__PICHAMBER__ as
    | { version?: number; protocol?: string; mode?: string }
    | undefined;
  if (marker?.version) return true;

  // 2. Check process environment fallback
  try {
    if (typeof process !== "undefined" && process.env?.PICHAMBER === "1") return true;
  } catch {}

  // 3. Check RPC mode with active UI bridge
  return ctx.mode === "rpc" && ctx.hasUI === true;
};
```

---

## API Capability & Adaptation Matrix

| Extension API Capability | Pi CLI (Terminal) | PiChamber (WebUI `:9999`) | Required Adaptation / Fallback Pattern |
| :--- | :--- | :--- | :--- |
| **`pi.registerProvider()`** | Registered immediately in CLI model catalog. | Intercepted via `extension.catalog` event; updates web dropdown instantly. | **Full Parity.** No restart needed. |
| **`pi.registerCommand()`** | Executed via `/command [args]`. | Discoverable via `extensions.list`; rendered as slash commands & button actions. | **Full Parity.** Action buttons route through prompt path. |
| **`pi.registerTool()`** | Executed by LLM; renders via `@earendil-works/pi-tui`. | Executed by LLM; tool frames stream over WebSocket. | **Hybrid Renderer Required.** Emit `pichamber.ui` for Web, TUI for CLI. |
| **`ctx.ui.confirm()`, `select()`, `input()`** | Interactive readline/curses prompt in terminal. | Intercepted via `extension.dialog`; renders modal dialog answered via `extensions.respond`. | **Full Parity.** Supports timeouts and cancel dismissal. |
| **`ctx.ui.form()`** | **Undefined!** (Throws error if called). | Native multi-field modal (`text`, `textarea`, `select`). Resolves with values object. | **Mandatory Fallback:** If `!ui.form`, fall back to sequential `ctx.ui.input()`. |
| **`pi.appendEntry('pichamber.ui', ...)`** | Degrades gracefully to custom JSON record in transcript. | Renders native reactive card (`table`, `progress`, etc.) with action buttons. | **PiChamber Enhancement.** Replaces in-place if `id` matches. |
| **`pi.appendEntry('pichamber.app', ...)`** | Ignored or logged as warning. | Sandboxed HTML app in iframe (`<button data-pichamber-command="...">`). | **PiChamber Exclusive.** Max 70 KB payload. |
| **`ctx.ui.setStatus()`** | Rendered in CLI status line / footer. | Normalized server-side map; rendered as header badges. Survives reconnects. | **Full Parity.** |
| **`ctx.ui.setWidget()`** | Rendered above or below CLI editor. | Rendered as banner above/below web prompt textarea. | **Full Parity.** |
| **`pi.registerShortcut()`** | Binds terminal key sequences (e.g. `Ctrl+K`). | **Ignored.** Browser window captures all keystrokes. | **CLI Exclusive.** Never place core logic only in shortcuts. |
| **`pi.registerFlag()`** | Parses command-line argv flags (`--flag`). | **Ignored.** Daemon sets process flags prior to loading. | **CLI Exclusive.** |
| **Child Process Spawning (`spawn`)** | Terminated when terminal process exits or on `Ctrl+C`. | Runs in daemon process. Can become **zombie** if WebSocket disconnects. | **Mandatory:** Must forward `AbortSignal` and cap output buffer (`50KB`). |

---

## Reference Navigation Index

Read ONLY the specific reference file needed for your current task:

- **Work, Setup & Environment**: Read `reference/build.md`
  - Manifest integration (`package.json`), Neovim/VS Code Draft-07 schema wiring, dual-runtime version constraints (CLI `0.86.x` vs PiChamber `0.85.1`), and port orchestration (`:4000`, `:4010`, `:9999`).
- **Architecture & Extension Internals**: Read `reference/source-code.md`
  - Full ASCII architectural topology, `omp-provider.ts` probe sequence and model catalog normalization, `subagent/` execution engine, and `pichamber-extension-ui` protocol specifications.
- **Diagnostics & Troubleshooting**: Read `reference/troubleshooting.md`
  - Service triage (`sdm ls`), zombie subagent process termination, snapshot cache flush, and npm `pi` math library namespace collision recovery.
