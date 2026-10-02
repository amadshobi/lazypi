# Changelog

All notable changes to `lazypi` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0] - 2026-10-02

### Removed
- **Agent Manager Extension (`extensions/agent-manager.ts`)**:
  - Dropped the session-level primary persona switcher (`/agent-select`, `<agent_switch name="..." />` interception).
  - The PiChamber counterpart (agent profiles selector, store, server route) was removed from the `feat/agent-profiles` branch; subagent rendering stays intact.
  - `extensions/subagent/agents.ts` discovery (`agents.json`, markdown agents) remains for subagent whitelisting only.

## [0.2.0] - 2026-10-01

### Added
- **Interactive Question Tool (`extensions/question.ts`)**:
  - Dual-surface human-in-the-loop interactive questioning tool.
  - Interactive terminal option list with inline `Editor` in Pi CLI (`@earendil-works/pi-tui`).
  - Native blocking modal overlay dialogs (`ctx.ui.select` & `ctx.ui.input`) in PiChamber WebUI.
- **Workflow Prompts (`prompts/`)**:
  - Registered `/implement`, `/scout-and-plan`, and `/implement-and-review` pipeline prompts.

### Changed
- **Repository Guidelines (`AGENTS.md`)**:
  - Updated architectural diagrams and runtime conventions for dual-surface execution.
  - Added verification and transpilation checks covering all active extensions.
