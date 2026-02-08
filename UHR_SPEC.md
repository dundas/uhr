# Universal Hook Registry (UHR) — Technical Specification

**Version:** 0.1.0-draft  
**Date:** February 3, 2026  
**Status:** Pre-implementation  
**Authors:** [dundas]

---

## 1. Problem Statement

AI coding CLIs — Claude Code, Cursor, and Gemini CLI — each implement lifecycle hook systems that allow external tools to intercept and respond to agent events (file edits, tool calls, session starts, etc.). These hooks are configured via JSON files that each tool owns exclusively.

When multiple services (e.g., GitButler, teleportation-cli, a formatter, a security scanner) need hooks in the same CLI, they face a coordination problem:

1. **Overwrite risk.** Each service writes to the same config file. Installing GitButler's hooks overwrites teleportation-cli's hooks.
2. **No conflict detection.** Two services may register contradictory permissions (one allows `Bash(teleport *)`, another denies it) with no warning.
3. **No reproducibility.** There's no lockfile to capture the resolved state. If the config gets corrupted, there's no way to regenerate it.
4. **Platform lock-in.** A service must maintain separate hook configs for each CLI it supports, with no shared abstraction.

UHR solves this the same way npm solved the dependency problem: each service declares what it needs in a manifest. A central resolver merges those declarations, detects conflicts, and generates the platform-native config files as build artifacts.

---

## 2. Design Principles

**2.1. Platform configs are generated artifacts.** `.claude/settings.json`, `.cursor/hooks.json`, and `.gemini/settings.json` are outputs — never edited by hand. They're rebuilt deterministically from the lockfile, the same way `node_modules` is rebuilt from `package-lock.json`.

**2.2. Append, don't replace.** Installing a new service adds its hooks alongside existing ones. Multiple hooks on the same event run sequentially in installation order. Nothing is overwritten.

**2.3. Explicit over implicit.** Conflicts are detected and surfaced before installation, not discovered at runtime. Services declare their requirements and incompatibilities up front.

**2.4. Platform-honest.** UHR does not pretend the three CLIs are equivalent. Where event semantics diverge, UHR translates honestly or declines to translate, rather than producing a broken mapping. Each adapter knows its platform's real capabilities.

**2.5. Zero runtime overhead.** UHR runs at install/uninstall/rebuild time only. It produces static config files. It adds no middleware, no daemon, no runtime dependency to the hook execution path.

---

## 3. Architecture Overview

```text
uhr CLI + resolver + conflict detector + lockfile + adapters (Claude/Cursor/Gemini)
```

---

## 4. Filesystem Layout

```text
~/.uhr/
  config.json
  uhr.lock.json
  services/
  overrides/

<project>/.uhr/
  uhr.lock.json
  services/
  overrides/

Generated outputs:
  ~/.claude/settings.json
  ~/.cursor/hooks.json
  ~/.gemini/settings.json
```

### 4.1 Scope Resolution

- User scope (`~/.uhr`) applies globally
- Project scope (`<project>/.uhr`) applies locally
- Project scope has higher precedence

---

## 5. Service Manifest Format

A service manifest declares hooks, permissions, ordering, requirements, and conflicts.

Core fields:
- `name`, `version`, `hooks`
- optional `permissions`, `ordering`, `requires`, `conflicts`, `meta`

Hook fields:
- `id`, `on`, `command`
- optional `tools`, `blocking`, `timeout`, `background`, `platforms`

Ordering supports `runAfter` and `runBefore` using `service/hook-id` references.

---

## 6. Universal Event Model

Canonical events include:
- `sessionStart`, `sessionEnd`
- `beforeToolExecution`, `afterToolExecution`
- `beforePromptSubmit`, `afterModelResponse`
- `beforeFileRead`, `beforeMcpExecution`
- `permissionRequest`, `notification`, `stop`, `subagentStop`
- `beforeCompact`, `beforeToolSelection`

Mappings differ by platform; lossy mappings must warn during rebuild.

Universal tools include `write`, `edit`, `multi-edit`, `bash`, `read`, `grep`, `fetch`, `*`.

---

## 7. Lockfile

Lockfile is source of truth and includes:
- `lockfileVersion`, timestamps, platforms
- installed services (version, integrity, source, hooks, permissions)
- `resolvedOrder` per event

Resolution order algorithm:
1. Collect hooks per event
2. Build dependency graph
3. Topological sort (tie-break by install time)
4. Error on cycles; ignore missing references

---

## 8. Platform Adapters

Each adapter translates universal hooks into platform-native config:
- Claude Code (`.claude/settings.json`)
- Cursor (`.cursor/hooks.json`) with known limitations
- Gemini CLI (`.gemini/settings.json`)

Adapter responsibilities:
1. Read lockfile resolved state
2. Translate event/tool names
3. Write output config
4. Emit warnings on unsupported mappings

---

## 9. Conflict Detection

Types:
- explicit conflicts (error)
- missing requirements (error)
- permission contradictions (error)
- duplicate hooks (warning)
- shared slots (info)
- circular ordering (error)
- platform gaps (warning)

Pattern overlap uses prefix-like matching for permission patterns and tool intersections.

---

## 10. CLI Interface

Commands:
- `uhr install <manifest>`
- `uhr uninstall <name>`
- `uhr update <name>`
- `uhr list`
- `uhr check <manifest>`
- `uhr diff <manifest>`
- `uhr rebuild`
- `uhr doctor`
- `uhr init`

Common options:
- `--scope`, `--platforms`, `--force`, `--dry-run`, `--verbose`, `--json`

---

## 11. Service Resolution Phases

1. Local file manifests
2. Git-based resolution
3. npm package resolution

---

## 12. Known Limitations

- Non-equivalent platform event semantics
- Cursor wrapper fragility
- Permission model differences
- No runtime conflict detection
- Metadata noise in generated configs
- Upstream schema changes require adapter updates

---

## 13. Security Considerations

- Hooks run with user permissions
- Manifest trust model is critical
- Integrity hashes detect post-install drift
- Generated files should clearly indicate UHR ownership

---

## 14. Integration with agentbootup

`agentbootup` can optionally call UHR install after template copy, and fall back to direct file copy when UHR is unavailable.

---

## 15. Proposed Project Structure

```text
uhr/
  bin/
  src/
  schema/
  test/
  package.json
  README.md
```

---

## 16. Implementation Roadmap

- Phase 1: Claude-only MVP
- Phase 2: Multi-platform adapters
- Phase 3: Git/npm distribution + permission prompts
- Phase 4: ecosystem tooling and docs

---

## 17. Open Questions

1. Preserve or reject existing non-UHR hooks?
2. Exact project-vs-user precedence behavior?
3. Target platform config tiers or user-selectable outputs?
4. Ordering guarantees vs runtime execution differences?
5. Version-pinned installs from git tags?

---

This file is a local project copy of the UHR draft specification for planning and implementation context.
