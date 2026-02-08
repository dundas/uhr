# End-to-End Test Plan: UHR Phase 1 — Claude-Only MVP

**Source:** `UHR_SPEC.md` + implementation gap analysis
**Generated:** 2026-02-07
**Environment:** Local/Development

---

## Environment Declaration

**Target Environment:** Local/Development
**Runtime:** Bun v1.3.3+
**Test Framework:** `bun test`

---

## Prerequisites

### 1. Services Required

| Service | Directory | Start Command |
|---------|-----------|---------------|
| UHR CLI | `/Users/kefentse/dev_env/uhr` | `bun run bin/uhr.ts` |

### 2. Health Checks

```bash
# Verify Bun is available
bun --version
# Expected: 1.3.3+

# Verify tests pass
bun test
# Expected: 16 pass, 0 fail

# Verify CLI responds
bun run bin/uhr.ts --help
# Expected: help text with command list
```

### 3. Test Fixtures

All tests use **temporary directories** created with `fs.mkdtemp` to isolate side effects. No shared state between test cases.

**Sample manifest (used across tests):**
```json
{
  "name": "test-formatter",
  "version": "1.0.0",
  "hooks": [
    {
      "id": "format-on-write",
      "on": "afterToolExecution",
      "tools": ["write", "edit"],
      "command": "prettier --write $UHR_FILE"
    }
  ],
  "permissions": {
    "allow": ["Bash(prettier *)"]
  }
}
```

---

## User Journey Map

```
┌─────────────────────────────────────────────────────────────┐
│ 1. INITIALIZATION                                           │
│    └─ uhr init → creates .uhr/uhr.lock.json                │
│    └─ Default platforms: ["claude-code"]                    │
│    └─ Custom platforms via --platforms                       │
├─────────────────────────────────────────────────────────────┤
│ 2. PRE-FLIGHT CHECK                                         │
│    └─ uhr check <manifest> → dry-run conflict detection     │
│    └─ uhr diff <manifest> → preview what would change       │
├─────────────────────────────────────────────────────────────┤
│ 3. INSTALLATION                                             │
│    └─ uhr install <manifest> → resolve + detect + write     │
│    └─ Lockfile updated with service                         │
│    └─ Manifest stored in .uhr/services/                     │
│    └─ .claude/settings.json generated                       │
├─────────────────────────────────────────────────────────────┤
│ 4. VERIFICATION                                             │
│    └─ uhr list → shows installed service                    │
│    └─ uhr doctor → no issues detected                       │
│    └─ .claude/settings.json has correct structure            │
├─────────────────────────────────────────────────────────────┤
│ 5. MULTI-SERVICE                                            │
│    └─ Install second service alongside first                │
│    └─ Both hooks present in config                          │
│    └─ Ordering constraints respected                        │
├─────────────────────────────────────────────────────────────┤
│ 6. CONFLICT SCENARIOS                                       │
│    └─ Explicit conflict blocks install                      │
│    └─ Missing requirement blocks install                    │
│    └─ Permission contradiction detected                     │
│    └─ --force overrides errors                              │
├─────────────────────────────────────────────────────────────┤
│ 7. UPDATE                                                   │
│    └─ uhr update <name> → re-read manifest, re-install      │
│    └─ Version changes reflected in lockfile                 │
├─────────────────────────────────────────────────────────────┤
│ 8. UNINSTALL                                                │
│    └─ uhr uninstall <name> → remove from lockfile           │
│    └─ .claude/settings.json regenerated without service      │
│    └─ Blocker detection if required by other service        │
├─────────────────────────────────────────────────────────────┤
│ 9. REBUILD                                                  │
│    └─ uhr rebuild → regenerate all configs from lockfile     │
│    └─ Deterministic: same lockfile → same output            │
├─────────────────────────────────────────────────────────────┤
│ 10. ERROR HANDLING                                          │
│     └─ Invalid manifest rejected with clear error           │
│     └─ Missing file paths produce helpful message           │
│     └─ Corrupt lockfile detected by doctor                  │
│     └─ Unknown command returns error                        │
└─────────────────────────────────────────────────────────────┘
```

**Coverage Checklist:**
- [ ] All 10 journey stages have at least one test case
- [ ] Both happy path and error paths covered
- [ ] Multi-service interactions tested

---

## Test Cases

### UNIT TESTS — Untested Modules

---

### Test U1: Lockfile Read/Write Round-Trip

**Purpose:** Verify lockfile I/O produces valid, deterministic output.
**Module:** `src/lockfile.ts`

#### Steps

1. **Create default lockfile**
   - Call `createDefaultLockfile()`
   - **Expected:** Returns object with `lockfileVersion: 1`, `platforms: ["claude-code"]`, empty `installed`, empty `resolvedOrder`

2. **Write lockfile to temp directory**
   - Call `writeLockfile("project", tmpDir, lockfile)`
   - **Expected:** File created at `<tmpDir>/.uhr/uhr.lock.json`, parent dirs created automatically

3. **Read lockfile back**
   - Call `readLockfile("project", tmpDir)`
   - **Expected:** Returns structurally identical object to what was written

4. **Read non-existent lockfile**
   - Call `readLockfile("project", emptyTmpDir)`
   - **Expected:** Returns default lockfile (not an error)

5. **Custom platforms**
   - Call `createDefaultLockfile(["claude-code", "cursor"])`
   - **Expected:** `platforms` is `["claude-code", "cursor"]`

#### Success Criteria
- [ ] Round-trip preserves all fields
- [ ] Missing lockfile returns default (not error)
- [ ] Parent directories created automatically

---

### Test U2: Permission Pattern Overlap

**Purpose:** Verify pattern matching logic for conflict detection.
**Module:** `src/util/patterns.ts`

#### Steps

1. **Exact match**
   - `permissionPatternsOverlap("Bash(npm test)", "Bash(npm test)")`
   - **Expected:** `true`

2. **Wildcard overlap**
   - `permissionPatternsOverlap("Bash(*)", "Bash(npm test)")`
   - **Expected:** `true`

3. **Prefix wildcard overlap**
   - `permissionPatternsOverlap("Bash(npm *)", "Bash(npm test)")`
   - **Expected:** `true`

4. **No overlap (different tools)**
   - `permissionPatternsOverlap("Bash(npm test)", "Read(file.ts)")`
   - **Expected:** `false`

5. **No overlap (different bodies)**
   - `permissionPatternsOverlap("Bash(npm test)", "Bash(yarn test)")`
   - **Expected:** `false`

6. **Tool overlap with wildcard**
   - `toolsOverlap(["*"], ["write"])`
   - **Expected:** `true`

7. **Tool overlap with undefined (defaults to *)**
   - `toolsOverlap(undefined, ["write"])`
   - **Expected:** `true`

8. **Tool no overlap**
   - `toolsOverlap(["bash"], ["write"])`
   - **Expected:** `false`

#### Success Criteria
- [ ] Exact, wildcard, and prefix matching all correct
- [ ] Different tools never overlap
- [ ] undefined/empty treated as wildcard

---

### Test U3: Integrity Hash

**Purpose:** Verify SHA-256 truncated hash is deterministic.
**Module:** `src/util/integrity.ts`

#### Steps

1. **Deterministic output**
   - Call `computeIntegrity("hello world")` twice
   - **Expected:** Same result both times

2. **Format check**
   - **Expected:** Matches pattern `sha256-[a-f0-9]{12}`

3. **Different input, different hash**
   - `computeIntegrity("hello world")` vs `computeIntegrity("hello world!")`
   - **Expected:** Different hashes

#### Success Criteria
- [ ] Deterministic
- [ ] Correct format
- [ ] Collision-resistant for distinct inputs

---

### Test U4: Rebuild From Lockfile

**Purpose:** Verify platform config generation from lockfile state.
**Module:** `src/rebuild.ts`

#### Steps

1. **Empty lockfile rebuild**
   - Call `rebuildFromLockfile(emptyLockfile, tmpDir)`
   - **Expected:** `writtenFiles` includes `.claude/settings.json`, file contains `_managedBy: "uhr"`, empty hooks

2. **Lockfile with one service**
   - Build lockfile with one installed service (afterToolExecution hook on write/edit)
   - Call `rebuildFromLockfile(lockfile, tmpDir)`
   - **Expected:** `.claude/settings.json` contains `PostToolUse` array with one entry, matcher is `Edit|Write`

3. **Warnings for unmapped events**
   - Service with `afterModelResponse` event (not mapped in Claude adapter)
   - **Expected:** `warnings` array includes message about unmapped event

#### Success Criteria
- [ ] Config file written to correct path
- [ ] Hook structure matches Claude Code format
- [ ] Warnings generated for unmapped events
- [ ] `_managedBy` and `_generatedAt` fields present

---

### INTEGRATION TESTS — Full Pipeline

---

### Test E1: Init → Install → List → Doctor (Happy Path)

**Purpose:** Verify the core user journey from scratch to working config.

#### Steps

1. **Init project**
   - Run `uhr init` in temp dir
   - **Expected:** Exit code 0, `.uhr/uhr.lock.json` created

2. **Create test manifest**
   - Write `test-formatter.json`:
     ```json
     {
       "name": "test-formatter",
       "version": "1.0.0",
       "hooks": [{
         "id": "format-on-write",
         "on": "afterToolExecution",
         "tools": ["write", "edit"],
         "command": "prettier --write $UHR_FILE"
       }],
       "permissions": { "allow": ["Bash(prettier *)"] }
     }
     ```

3. **Install service**
   - Run `uhr install test-formatter.json`
   - **Expected:** Exit code 0, output contains "Installed test-formatter@1.0.0"

4. **Verify lockfile**
   - Read `.uhr/uhr.lock.json`
   - **Expected:** `installed["test-formatter"]` exists with version "1.0.0", integrity hash present, hooks match manifest

5. **Verify stored manifest**
   - **Expected:** `.uhr/services/test-formatter.json` exists

6. **Verify generated config**
   - Read `.claude/settings.json`
   - **Expected:**
     - `_managedBy` is `"uhr"`
     - `hooks.PostToolUse` has entry with `matcher: "Edit|Write"` and command `"prettier --write $UHR_FILE"`
     - `permissions.allowedTools` includes `"Bash(prettier *)"`

7. **List services**
   - Run `uhr list`
   - **Expected:** Output contains `test-formatter@1.0.0`

8. **Doctor check**
   - Run `uhr doctor`
   - **Expected:** "No issues detected."

#### Success Criteria
- [ ] Full pipeline from init to verified config
- [ ] Generated `.claude/settings.json` is valid and correct
- [ ] Doctor reports no issues after clean install

---

### Test E2: Multi-Service Install with Ordering

**Purpose:** Two services installed with ordering constraints; verify resolved order.

#### Steps

1. **Init and install service A**
   - `test-linter` with hook `lint-check` on `beforeToolExecution`

2. **Install service B with runAfter constraint**
   - `test-security` with hook `security-scan` on `beforeToolExecution`, `ordering: { "security-scan": { runAfter: ["test-linter/lint-check"] } }`

3. **Verify resolvedOrder in lockfile**
   - **Expected:** `resolvedOrder.beforeToolExecution` is `["test-linter/lint-check", "test-security/security-scan"]`

4. **Verify generated config**
   - **Expected:** `hooks.PreToolUse` array has linter before security scanner

5. **List shows both**
   - **Expected:** Both `test-linter` and `test-security` listed

#### Success Criteria
- [ ] Ordering constraint respected in lockfile
- [ ] Ordering reflected in generated config (array order)
- [ ] Both services coexist

---

### Test E3: Conflict Detection — Explicit Conflict

**Purpose:** Installing a service that declares conflict with existing service is blocked.

#### Steps

1. **Install `service-a`**

2. **Attempt install `service-b` with `conflicts: ["service-a"]`**
   - **Expected:** Exit code 1, output contains "conflicts with service-a"

3. **Force install**
   - Run with `--force`
   - **Expected:** Exit code 0, installed despite conflict

#### Success Criteria
- [ ] Conflict detected and blocks install
- [ ] `--force` overrides

---

### Test E4: Conflict Detection — Missing Requirement

**Purpose:** Service that requires an uninstalled dependency is blocked.

#### Steps

1. **Attempt install `service-b` with `requires: ["service-a"]`** (service-a not installed)
   - **Expected:** Exit code 1, output contains "requires service-a"

2. **Install service-a first, then service-b**
   - **Expected:** Exit code 0 for both

#### Success Criteria
- [ ] Missing requirement detected
- [ ] Satisfied requirement allows install

---

### Test E5: Conflict Detection — Permission Contradiction

**Purpose:** Conflicting allow/deny permissions detected.

#### Steps

1. **Install `service-a` with `permissions: { deny: ["Bash(rm *)"] }`**

2. **Attempt install `service-b` with `permissions: { allow: ["Bash(rm -rf *)"] }`**
   - **Expected:** Exit code 1, permission contradiction reported

#### Success Criteria
- [ ] Pattern overlap correctly detects contradiction
- [ ] Clear error message with both patterns

---

### Test E6: Uninstall — Clean Removal

**Purpose:** Removing a service cleans up lockfile and regenerates config.

#### Steps

1. **Install two services: `service-a` and `service-b`**

2. **Uninstall `service-a`**
   - **Expected:** Exit code 0

3. **Verify lockfile**
   - **Expected:** `installed` has only `service-b`, `resolvedOrder` updated

4. **Verify generated config**
   - **Expected:** `.claude/settings.json` has only `service-b` hooks

5. **Verify stored manifest removed**
   - **Expected:** `.uhr/services/service-a.json` deleted

#### Success Criteria
- [ ] Service fully removed from lockfile
- [ ] Config regenerated without removed service
- [ ] Stored manifest deleted

---

### Test E7: Uninstall — Blocker Detection

**Purpose:** Cannot uninstall a service required by another.

#### Steps

1. **Install `service-a`**
2. **Install `service-b` with `requires: ["service-a"]`** (force if needed)
3. **Attempt uninstall `service-a`**
   - **Expected:** Exit code 1, "required by: service-b"

#### Success Criteria
- [ ] Uninstall blocked when service is required

---

### Test E8: Update — Re-read and Re-install

**Purpose:** Updating a service re-reads manifest and updates lockfile.

#### Steps

1. **Install `test-formatter` v1.0.0**
2. **Modify manifest to v2.0.0 with additional hook**
3. **Run `uhr update test-formatter`**
   - **Expected:** Exit code 0, lockfile shows v2.0.0, new hook in config

#### Success Criteria
- [ ] Version updated in lockfile
- [ ] New hooks reflected in generated config

---

### Test E9: Rebuild — Deterministic Regeneration

**Purpose:** Rebuild from lockfile produces identical output.

#### Steps

1. **Install a service**
2. **Delete `.claude/settings.json`**
3. **Run `uhr rebuild`**
   - **Expected:** `.claude/settings.json` recreated with identical content (except `_generatedAt` timestamp)

#### Success Criteria
- [ ] Config regenerated from lockfile alone
- [ ] Hook structure matches pre-deletion

---

### Test E10: Check — Dry-Run Conflict Detection

**Purpose:** `uhr check` detects conflicts without modifying anything.

#### Steps

1. **Install `service-a`**
2. **Create `service-b.json` with conflict against `service-a`**
3. **Run `uhr check service-b.json`**
   - **Expected:** Exit code 1, conflict reported
4. **Verify lockfile unchanged**
   - **Expected:** Still only `service-a` installed

#### Success Criteria
- [ ] Conflicts reported
- [ ] No side effects (lockfile and config unchanged)

---

### Test E11: Diff — Preview Changes

**Purpose:** `uhr diff` shows what would change on install.

#### Steps

1. **Run `uhr diff test-formatter.json`** (service not installed)
   - **Expected:** Shows "not installed" → v1.0.0, hooks to add listed

2. **Install, then run diff with modified manifest**
   - **Expected:** Shows version change and hook additions/removals

#### Success Criteria
- [ ] Accurate diff output for new install
- [ ] Accurate diff for update scenario

---

### Test E12: Doctor — Issue Detection

**Purpose:** Doctor catches common problems.

#### Steps

1. **Missing lockfile**
   - Run `uhr doctor` in fresh temp dir
   - **Expected:** Warning about missing lockfile

2. **Stale config**
   - Install service, then manually write lockfile with newer `generatedAt`
   - **Expected:** Warning about stale config

3. **Invalid JSON in config**
   - Write `{broken` to `.claude/settings.json`
   - **Expected:** Warning about invalid JSON

4. **Integrity mismatch**
   - Modify stored manifest content after install
   - **Expected:** Warning about integrity mismatch

5. **JSON output**
   - Run `uhr doctor --json`
   - **Expected:** Valid JSON with `issues` array

#### Success Criteria
- [ ] Each issue type detected
- [ ] Severity levels correct (warning vs error)
- [ ] JSON output mode works

---

### ERROR HANDLING TESTS

---

### Test ERR1: Invalid Manifest

**Purpose:** Clear error on bad manifest input.

#### Steps

1. **Missing required fields** (`{}`)
   - **Expected:** Error about missing `name`

2. **Invalid hook** (blocking + background)
   - **Expected:** Error "cannot be both blocking and background"

3. **Non-existent file**
   - **Expected:** Error about file not found

4. **Invalid JSON**
   - **Expected:** Error about JSON parse failure

#### Success Criteria
- [ ] Each invalid input produces specific, helpful error message

---

### Test ERR2: CLI Error Handling

**Purpose:** CLI handles edge cases gracefully.

#### Steps

1. **Unknown command**
   - `uhr foobar`
   - **Expected:** Exit code 1, error message

2. **Missing required argument**
   - `uhr install` (no path)
   - **Expected:** Exit code 1, usage hint

3. **Unknown flag**
   - `uhr install foo.json --unknown`
   - **Expected:** Exit code 1, "Unknown option: --unknown"

4. **Invalid platform**
   - `uhr init --platforms=foo`
   - **Expected:** Exit code 1, "Unsupported platform(s): foo"

#### Success Criteria
- [ ] All error cases return non-zero exit code
- [ ] Error messages are actionable

---

### CLAUDE CODE ADAPTER VALIDATION

---

### Test A1: Generated Config Structure

**Purpose:** Verify `.claude/settings.json` matches what Claude Code expects.

#### Steps

1. **Install service with multiple event types**
   - Hooks on: `beforeToolExecution`, `afterToolExecution`, `stop`, `sessionStart`, `beforePromptSubmit`
   - Tools: `write`, `edit`, `bash`

2. **Verify event mapping**
   - **Expected mappings:**
     - `beforeToolExecution` → `PreToolUse`
     - `afterToolExecution` → `PostToolUse`
     - `stop` → `Stop`
     - `sessionStart` → `SessionStart`
     - `beforePromptSubmit` → `UserPromptSubmit`

3. **Verify tool mapping in matcher**
   - **Expected:** `write` → `Write`, `edit` → `Edit`, `bash` → `Bash`
   - Matcher format: `"Edit|Write"` (pipe-separated, sorted)

4. **Verify hook entry structure**
   ```json
   {
     "matcher": "Edit|Write",
     "_uhrSource": "service-name/hook-id",
     "hooks": [{ "type": "command", "command": "..." }]
   }
   ```

5. **Verify permissions**
   - **Expected:** `permissions.allowedTools` contains merged allow list from all services

6. **Verify UHR metadata**
   - **Expected:** `_managedBy: "uhr"`, `_generatedAt` is ISO string, `_warning` present

#### Success Criteria
- [ ] All event mappings correct
- [ ] Tool matcher format correct
- [ ] Hook entry structure matches Claude Code expectations
- [ ] Permissions correctly aggregated

---

### Test A2: Unmapped Event Warnings

**Purpose:** Events without Claude Code mapping produce warnings, not errors.

#### Steps

1. **Install service with `afterModelResponse` hook** (unmapped in Claude)
   - **Expected:** Warning emitted, other hooks still generated, exit code 0

#### Success Criteria
- [ ] Warning message names the unmapped event
- [ ] Mapped hooks still generated correctly

---

## Troubleshooting

### Tests Fail on File Permissions

**Symptom:** `EACCES` errors writing to temp directories
**Fix:** Ensure temp dir is writable: `mktemp -d`

### CLI Hangs

**Symptom:** `uhr` command doesn't return
**Check:** Verify no infinite loop in resolver (circular dependency without detection)
**Fix:** Check `topologicalSort` for cycle detection

### Config Not Generated

**Symptom:** `.claude/settings.json` missing after install
**Check:** Verify `lockfile.platforms` includes `"claude-code"`
**Fix:** Run `uhr init --platforms=claude-code` or check lockfile

---

## E2E Completion Criteria

### The Production Reality Rule

> **If an issue would happen when a real user runs `uhr install`, it is NOT "unrelated" — fix it NOW.**

### Completion Checklist

- [ ] `uhr init` creates valid lockfile
- [ ] `uhr install` produces correct `.claude/settings.json`
- [ ] `uhr list` shows installed services
- [ ] `uhr doctor` reports no issues after clean install
- [ ] `uhr check` detects conflicts without side effects
- [ ] `uhr diff` accurately previews changes
- [ ] `uhr update` re-reads and re-installs
- [ ] `uhr uninstall` fully removes service and regenerates config
- [ ] `uhr rebuild` deterministically regenerates from lockfile
- [ ] Multi-service ordering works
- [ ] All 7 conflict types detected correctly
- [ ] `--force` overrides errors
- [ ] Invalid input produces clear, actionable errors
- [ ] Generated `.claude/settings.json` is valid for Claude Code consumption
- [ ] All tests pass: `bun test` exits 0

### Fix-In-Place Protocol

When ANY issue is encountered during testing:
1. **STOP** — Don't mark the test as passing
2. **ASSESS** — Would this happen when a real user runs `uhr install`?
3. **If YES → FIX IT NOW**
4. **RE-VALIDATE** — Re-run the test after fix
5. **REPEAT** — Until the full flow works

### Sign-Off

- [ ] All issues encountered during E2E testing have been addressed
- [ ] No issues deferred as "out of scope"
- [ ] Tester confirms: "A user could run `uhr install <manifest>` and get a correct `.claude/settings.json`"

**Signed:** _____________ **Date:** _____________

---

## Issue Tracking

### Run Log

| Test | Expected | Actual | Status | Fix Commit |
|------|----------|--------|--------|------------|
| U1: Lockfile round-trip | | | | |
| U2: Pattern overlap | | | | |
| U3: Integrity hash | | | | |
| U4: Rebuild | | | | |
| E1: Happy path | | | | |
| E2: Multi-service ordering | | | | |
| E3: Explicit conflict | | | | |
| E4: Missing requirement | | | | |
| E5: Permission contradiction | | | | |
| E6: Uninstall clean | | | | |
| E7: Uninstall blocker | | | | |
| E8: Update | | | | |
| E9: Rebuild deterministic | | | | |
| E10: Check dry-run | | | | |
| E11: Diff preview | | | | |
| E12: Doctor issues | | | | |
| ERR1: Invalid manifest | | | | |
| ERR2: CLI errors | | | | |
| A1: Config structure | | | | |
| A2: Unmapped warnings | | | | |

---

*Test plan generated 2026-02-07 by test-plan-generator skill*
