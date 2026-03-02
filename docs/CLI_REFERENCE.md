# UHR CLI Reference

<!-- Generated: 2026-03-02 | Source: src/cli.ts -->

Universal Hook Registry — npm-style dependency resolution for AI coding CLI hooks.

## Installation

```bash
npm install -g uhr
# or with bun
bun install -g uhr
```

## Global Flags

All commands accept these flags where applicable:

| Flag | Description |
|------|-------------|
| `--platforms <list>` | Comma-separated platform IDs: `claude-code`, `cursor`, `gemini-cli` |
| `--force` | Override conflict errors |
| `--dry-run` | Preview changes without writing |
| `--yes` / `-y` | Skip confirmation prompts |
| `--mode <mode>` | Merge mode: `strict`, `preserve`, `hybrid` |
| `--json` | Output machine-readable JSON |

---

## Commands

### `uhr init`

Initialize UHR in the current project. Creates `.uhr/uhr.lock.json`.

```
uhr init [--platforms <list>]
```

**Arguments**: none

**Flags**:
- `--platforms` — Platforms to activate. Default: `claude-code`

**Examples**:
```bash
uhr init
uhr init --platforms claude-code,cursor,gemini-cli
```

**Output**: Path to created lockfile.

---

### `uhr install`

Install a service from a manifest file. Runs conflict detection before writing. Regenerates all platform configs.

```
uhr install <manifest> [--force] [--platforms <list>]
```

**Arguments**:
- `<manifest>` — Path to service manifest JSON file (required)

**Flags**:
- `--force` — Override conflict errors and install anyway
- `--platforms` — Override active platforms for this install session (ephemeral — does not change the lockfile's platform list)

**Behavior**:
1. Loads and validates the manifest
2. Detects conflicts against installed services
3. Aborts on error-severity conflicts (unless `--force`)
4. Writes service entry to lockfile
5. Stores manifest copy in `.uhr/services/<name>.json`
6. Rebuilds all platform configs
7. Warns if the service has hooks but none target the active platforms

**Exit codes**: `0` = success, `1` = conflict errors

**Examples**:
```bash
uhr install ./my-service.json
uhr install ./my-service.json --force
uhr install ./my-service.json --platforms claude-code,cursor
```

---

### `uhr uninstall`

Remove an installed service and regenerate platform configs.

```
uhr uninstall <name>
```

**Arguments**:
- `<name>` — Service name (as declared in its manifest)

**Behavior**: Blocked if other installed services declare `requires: ["<name>"]`.

**Examples**:
```bash
uhr uninstall my-service
```

---

### `uhr update`

Re-install a service from its original source path. Equivalent to reinstalling from the same manifest file.

```
uhr update <name> [--force] [--platforms <list>]
```

**Arguments**:
- `<name>` — Installed service name

**Flags**: Same as `install`.

**Limitation**: Only works for `local:` sourced services (installed from a file path).

**Examples**:
```bash
uhr update my-service
uhr update my-service --force
```

---

### `uhr list`

List all installed services.

```
uhr list
```

**Output**: Service name, version, hook count, and install timestamp for each service.

---

### `uhr check`

Dry-run conflict check against a manifest. Does not install.

```
uhr check <manifest>
```

**Arguments**:
- `<manifest>` — Path to manifest JSON file

**Exit codes**: `0` = no conflict errors, `1` = errors detected

**Examples**:
```bash
uhr check ./new-service.json
```

---

### `uhr diff`

Show what would change if a manifest were installed or updated.

```
uhr diff <manifest>
```

**Arguments**:
- `<manifest>` — Path to manifest JSON file

**Output**:
- Version: current → new
- Hooks to add (`+`)
- Hooks to remove (`-`)
- Hooks changed (`~`)
- Whether permissions changed

**Examples**:
```bash
uhr diff ./updated-service.json
```

---

### `uhr rebuild`

Regenerate all platform config files from the lockfile. Use after manual lockfile edits or to resync configs.

```
uhr rebuild [--platforms <list>]
```

**Flags**:
- `--platforms` — Generate configs only for these platforms. **Ephemeral** — does not change the lockfile's platform list. The lockfile is still written without modification.

**Examples**:
```bash
uhr rebuild
uhr rebuild --platforms claude-code
```

---

### `uhr doctor`

Diagnose issues with the current UHR installation.

```
uhr doctor [--json]
```

**Flags**:
- `--json` — Output issues as JSON array

**Checks performed**:
- Lockfile exists and is valid
- Generated platform configs exist for all lockfile platforms
- Platform configs are UHR-managed and not stale
- UHR-managed configs exist for platforms not in the lockfile (orphan detection)
- Stored manifests exist in `.uhr/services/`
- Source manifest integrity matches lockfile integrity hash
- Services where all hooks target non-active platforms (zero effective hooks)
- Imported services at risk under `strict` merge mode
- Stale entries in the backup index
- Imported services whose source platform config is missing

**Exit codes**: `0` = no errors, `1` = at least one error-severity issue

**Issue severities**: `error`, `warning`, `info`

**Examples**:
```bash
uhr doctor
uhr doctor --json
```

---

### `uhr restore`

List or restore from a backup.

```
uhr restore [timestamp]
```

**Arguments**:
- `[timestamp]` — Optional. If omitted, lists available backups. If provided, restores from that backup.

**Examples**:
```bash
uhr restore                        # List available backups
uhr restore 2026-03-02T12-00-00    # Restore from specific backup
```

---

### `uhr import`

Scan existing platform configs and report importable hooks. **Read-only** — makes no changes.

```
uhr import [--platforms <list>] [--json]
```

**Flags**:
- `--platforms` — Which platforms to scan. Default: all (`claude-code`, `cursor`, `gemini-cli`)
- `--json` — Output discovery results as JSON

**Use case**: Inspect what hooks would be imported before running `migrate`.

**Examples**:
```bash
uhr import
uhr import --platforms claude-code
uhr import --json
```

---

### `uhr migrate`

Import existing platform hooks into UHR management. Combines `import` + `install` in one workflow.

```
uhr migrate [--mode preserve] [--dry-run] [--yes] [--platforms <list>]
```

**Flags**:
- `--mode` — Merge mode: `strict`, `preserve`, `hybrid`. Default: `preserve`
- `--dry-run` — Preview the migration plan without writing
- `--yes` — Apply the migration (required to actually write)
- `--platforms` — Which platforms to scan and import from

**Behavior** (with `--yes`):
1. Scans platform configs for existing hooks
2. Registers imported hooks as `"ownership": "imported"` services in the lockfile
3. Writes lockfile with selected merge mode
4. Rebuilds platform configs

**Merge mode semantics**:
- `strict` — UHR owns and controls all hooks; imported hooks may be overwritten on rebuild
- `preserve` — Imported hooks are preserved alongside UHR-managed hooks
- `hybrid` — Mixed: UHR-managed services are strict, others are preserved

**Examples**:
```bash
uhr migrate --dry-run
uhr migrate --mode preserve --yes
uhr migrate --mode strict --platforms claude-code --yes
```

---

## Manifest Format

Services declare their requirements in a JSON manifest file:

```json
{
  "$schema": "https://uhr.dev/schema/manifest.v1.json",
  "name": "my-service",
  "version": "1.0.0",
  "description": "What this service does",
  "hooks": [
    {
      "id": "on-session-start",
      "on": "sessionStart",
      "command": "echo 'session started'",
      "platforms": ["claude-code"],
      "blocking": false,
      "timeout": 5000
    }
  ],
  "permissions": {
    "allow": ["Bash(git *)"],
    "deny": ["Bash(rm -rf *)"]
  },
  "ordering": {
    "other-service": { "runAfter": ["other-service"] }
  },
  "requires": ["other-service"],
  "conflicts": ["incompatible-service"]
}
```

### Hook Fields

| Field | Required | Type | Description |
|-------|----------|------|-------------|
| `id` | Yes | string | Unique identifier within the service |
| `on` | Yes | UniversalEvent | When this hook fires |
| `command` | Yes | string | Shell command to execute |
| `platforms` | No | PlatformId[] | Restrict to specific platforms. Omit = all platforms |
| `tools` | No | string[] | Tool filter (e.g. `["Bash", "Read"]`). Omit = all tools |
| `blocking` | No | boolean | Whether to block execution until hook completes |
| `timeout` | No | number | Timeout in milliseconds |
| `background` | No | boolean | Run in background without blocking |

### Universal Events

`sessionStart` · `sessionEnd` · `beforeToolExecution` · `afterToolExecution` · `beforePromptSubmit` · `afterModelResponse` · `beforeFileRead` · `beforeMcpExecution` · `permissionRequest` · `notification` · `stop` · `subagentStop` · `beforeCompact` · `beforeToolSelection`

---

## Conflict Detection

UHR detects conflicts before installation:

| Type | Severity | Description |
|------|----------|-------------|
| `explicit` | error | `conflicts` field lists an installed service |
| `missing_requirement` | error | `requires` dependency not installed |
| `permission_contradiction` | error | Service allows what another denies (or vice versa) |
| `duplicate_hook` | warning | Identical hook (event+tools+command) already registered |
| `shared_slot` | warning | Same event+tools, different command |
| `circular_ordering` | error | Cycle in `ordering` constraints |
| `platform_gap` | warning | Hook targets a platform not in lockfile's platform list |
| `ownership_collision` | warning | UHR-managed hook conflicts with imported hook |

Use `--force` to override warning and error conflicts and install anyway.

---

## File Layout

```
<project>/
├── .uhr/
│   ├── uhr.lock.json          # Lockfile (source of truth)
│   ├── services/
│   │   └── <name>.json        # Stored manifest copies
│   └── backups/               # Backup snapshots
├── .claude/
│   └── settings.json          # Generated — Claude Code config
├── .cursor/
│   └── hooks.json             # Generated — Cursor config
└── .gemini/
    └── settings.json          # Generated — Gemini CLI config
```

**Generated files are build artifacts.** Do not edit them by hand — edit the manifest and run `uhr rebuild`.
