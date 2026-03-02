# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

### Documentation
- Added `llms.txt` (173-line AI agent reference), `docs/CLI_REFERENCE.md` (full CLI command reference), and `docs/ARCHITECTURE.md` (Mermaid diagrams, design principles, directory layout). All generated from source as single source of truth. Config at `docs-generator.json`. (PR #11, 68ca22a, 2026-03-02)

### Fixed
- Platform-specific hooks no longer leak across adapter configs — a `platforms: ["cursor"]` hook no longer appears in `.claude/settings.json`. All three adapters now filter hooks by their declared `platforms` field. (PR #12, 8075836, 2026-03-02, closes #9)
- `platform_gap` conflict warning now only fires when ALL of a hook's target platforms are absent from the lockfile; hooks targeting `["claude-code", "cursor"]` on a claude-code-only lockfile no longer produce a false positive. (PR #12, 8075836, 2026-03-02)
- `rebuild --platforms` no longer permanently overwrites lockfile platforms — it is now a one-time adapter filter only (PR #10, eb4d08d, 2026-03-02)
- `uhr install` now warns clearly when a service's hooks all target platforms absent from the lockfile, instead of silently succeeding (PR #10, eb4d08d, 2026-03-02)
- `uhr doctor` now detects services with zero hooks for any active lockfile platform (PR #10, eb4d08d, 2026-03-02)

### Changed
- Extracted `hooksForPlatforms()` utility to `src/util/patterns.ts`, eliminating duplicate hook-platform filter logic between `cli.ts` and `doctor.ts` (PR #10, eb4d08d, 2026-03-02)
