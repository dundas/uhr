# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

### Documentation
- Added `llms.txt` (173-line AI agent reference), `docs/CLI_REFERENCE.md` (full CLI command reference), and `docs/ARCHITECTURE.md` (Mermaid diagrams, design principles, directory layout). All generated from source as single source of truth. Config at `docs-generator.json`. (PR #11, 68ca22a, 2026-03-02)

### Fixed
- `rebuild --platforms` no longer permanently overwrites lockfile platforms — it is now a one-time adapter filter only (PR #10, eb4d08d, 2026-03-02)
- `uhr install` now warns clearly when a service's hooks all target platforms absent from the lockfile, instead of silently succeeding (PR #10, eb4d08d, 2026-03-02)
- `uhr doctor` now detects services with zero hooks for any active lockfile platform (PR #10, eb4d08d, 2026-03-02)

### Changed
- Extracted `hooksForPlatforms()` utility to `src/util/patterns.ts`, eliminating duplicate hook-platform filter logic between `cli.ts` and `doctor.ts` (PR #10, eb4d08d, 2026-03-02)
