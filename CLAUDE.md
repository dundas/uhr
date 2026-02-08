# UHR — Universal Hook Registry

## What This Is

UHR applies the npm dependency model to AI coding CLI hooks. Services declare hook requirements in a manifest, a central resolver merges declarations, detects conflicts, and generates platform-native configs as build artifacts.

**Platform configs (`.claude/settings.json`, `.cursor/hooks.json`, `.gemini/settings.json`) are generated artifacts — never edited by hand.**

## Build & Development Commands

```bash
# Install dependencies (uses Bun, not npm)
bun install

# Run CLI locally
bun run bin/uhr.ts

# Run tests
bun test

# Type check
bun run typecheck

# Lint
bun run lint
```

## Architecture

```
uhr/
├── bin/              # CLI entry point
├── src/
│   ├── cli/          # Command handlers (install, uninstall, rebuild, doctor, etc.)
│   ├── resolver/     # Manifest resolution + topological sort
│   ├── conflict/     # Conflict detection engine
│   ├── lockfile/     # Lockfile read/write/integrity
│   ├── adapters/     # Platform adapters (Claude, Cursor, Gemini)
│   └── types/        # Shared TypeScript types
├── schema/           # JSON schemas for manifests, lockfile, configs
├── test/             # Tests (mirror src/ structure)
├── UHR_SPEC.md       # Full technical specification
└── package.json
```

### Core Pipeline

```
Service Manifest → Resolver → Conflict Detector → Lockfile → Platform Adapters → Generated Configs
```

1. **Resolver**: Reads manifests, resolves ordering with topological sort
2. **Conflict Detector**: Checks for permission contradictions, circular deps, missing requirements
3. **Lockfile**: Deterministic state of all installed services + resolved order
4. **Platform Adapters**: Translate universal hooks to platform-native config files

### Key Design Principles

- **Zero runtime overhead** — build-time only, produces static config files
- **Append, don't replace** — installing a service adds hooks alongside existing ones
- **Explicit over implicit** — conflicts detected before installation, not at runtime
- **Platform-honest** — adapters translate honestly or decline, never produce broken mappings

## Tech Stack

- **Runtime**: Bun (not Node.js)
- **Language**: TypeScript (strict mode)
- **Distribution**: npm package (`uhr`)
- **CLI framework**: Minimal — Bun.argv + custom parser (no heavy deps)
- **Testing**: `bun test`
- **Config format**: JSON (manifests, lockfile, generated configs)

## CLI Commands

```bash
uhr install <manifest>    # Install service hooks from manifest
uhr uninstall <name>      # Remove service hooks
uhr update <name>         # Update service to latest manifest
uhr list                  # List installed services
uhr check <manifest>      # Dry-run conflict check
uhr diff <manifest>       # Show what would change
uhr rebuild               # Regenerate all platform configs from lockfile
uhr doctor                # Diagnose issues
uhr init                  # Initialize .uhr/ in project or home
```

Common flags: `--scope`, `--platforms`, `--force`, `--dry-run`, `--verbose`, `--json`

## Implementation Roadmap

- **Phase 1**: Claude-only MVP (single adapter, core resolver, conflict detection)
- **Phase 2**: Multi-platform adapters (Cursor, Gemini)
- **Phase 3**: Git/npm distribution + permission prompts
- **Phase 4**: Ecosystem tooling and docs

## Commit Format

```
<type>(<scope>): <description>
```

Types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`
Scopes: `cli`, `resolver`, `conflict`, `lockfile`, `adapter`, `schema`

## Cross-Brain Messaging

At session start, check for messages from other brains:
```bash
bun .claude/skills/cross-brain-message/brain-msg.ts inbox
```

When you discover something affecting another service, send a message:
```bash
bun .claude/skills/cross-brain-message/brain-msg.ts send --to <agent> --type <type> --subject "..." --body '{...}'
```

This agent is `uhr-gm`. See `bun .claude/skills/cross-brain-message/brain-msg.ts agents` for all registered agents.

## Autonomous Memory System

This project uses the agentbootup self-improvement system for continuous learning and autonomous operation.

### Memory Files (Always Consult)

**At session start, read**:
1. `memory/MEMORY.md` - Core operational knowledge and protocols
2. `memory/daily/<today>.md` - Today's session log (if exists)

**At session end, update**:
1. `memory/daily/<today>.md` - Session summary, decisions, learnings
2. `memory/MEMORY.md` - New permanent patterns (if discovered)

### Key Principles

**Decision-Making**:
- Act autonomously on: technical choices, testing, documentation, memory updates
- Ask for input on: destructive actions, external communications, strategic direction

**Error Handling**:
- Fix issues immediately
- Never mark tasks complete with caveats
- Test until it actually works
- Update memory with lessons learned

**Phase Gates**:
- Complete each phase fully
- Pause at major transitions
- Wait for explicit "Go" or "yes"
- No partial work left behind

### Standing Orders

1. Check memory at session start
2. Learn continuously — update memory after significant interactions
3. Build skills permanently for novel challenges
4. Pause at phase gates
5. Test before completion
6. Act proactively on routine items, ask before destructive actions
7. Document decisions in daily logs
8. Fix issues immediately
