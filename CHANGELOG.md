# Changelog

All notable changes to `lazypi` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
