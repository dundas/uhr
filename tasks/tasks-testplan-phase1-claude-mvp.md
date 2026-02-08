# Task List: UHR Phase 1 — Claude-Only MVP Test Coverage

**Source:** `tasks/testplan-phase1-claude-mvp.md`
**Generated:** 2026-02-07

---

## Relevant Files

### New Files to Create

**Unit Tests:**
- `test/util/patterns.test.ts` - Permission pattern overlap tests (8+ assertions)
- `test/util/integrity.test.ts` - SHA-256 integrity hash tests (3+ assertions)
- `test/lockfile.test.ts` - Lockfile read/write round-trip tests (5+ assertions)
- `test/rebuild.test.ts` - Rebuild from lockfile tests (3+ assertions)

**Integration Tests:**
- `test/integration/helpers.ts` - Shared test fixtures, temp dir setup, manifest builders
- `test/integration/pipeline.test.ts` - Happy path pipeline tests (E1, E2, E8, E9, E11)
- `test/integration/conflicts.test.ts` - Conflict detection integration tests (E3, E4, E5, E10)
- `test/integration/uninstall.test.ts` - Uninstall flow tests (E6, E7)

**Error Handling Tests:**
- `test/cli-errors.test.ts` - CLI error handling tests (ERR1, ERR2)

**Adapter Validation Tests:**
- `test/adapters/claude-code-full.test.ts` - Full adapter structure validation (A1, A2)
- `test/integration/doctor.test.ts` - Doctor issue detection integration tests (E12)

### Existing Files to Modify

- None expected (implementation is complete; we are adding test coverage)

---

## Commit & PR Strategy

### Commit Frequency
- **Small commits:** After each test file is written and passing
- **Commit message format:** `test(scope): description`
- **Types:** `test`, `fix` (if implementation bugs found)

### PR Strategy
- **One PR per parent task** (7 PRs total)
- Each PR includes: tests + any bugfixes discovered
- PR naming: `Phase 1.X: [Parent Task Name]`
- Merge strategy: Squash and merge

### PR Dependencies
```
PR 1 (Task 1.0) ──┐
PR 2 (Task 2.0) ──┼── PR 3 (Task 3.0) ── PR 5 (Task 5.0)
PR 6 (Task 6.0) ──┘         │
PR 1 (Task 1.0) ──────── PR 4 (Task 4.0)
PR 2 (Task 2.0) ──────── PR 7 (Task 7.0)
```

- PR 1, PR 2, PR 6 can start immediately (parallel)
- PR 3 depends on PR 1 + PR 2
- PR 4 depends on PR 1
- PR 5 depends on PR 3
- PR 7 depends on PR 2

---

## Tasks

### 1.0 Unit Tests for Utility Modules (patterns, integrity)
**Agent:** `tdd-developer`
**PR:** `#1 - Phase 1.1: Unit tests for utility modules`
**Effort:** Medium
**Depends on:** (none)

- [ ] **1.1** Test permission pattern overlap — exact and wildcard matches
  - **File:** `test/util/patterns.test.ts` (create)
  - **Action:** Create test file with `describe("permissionPatternsOverlap")` block. Test cases: exact match returns true, wildcard `Bash(*)` overlaps `Bash(npm test)`, prefix wildcard `Bash(npm *)` overlaps `Bash(npm test)`, different tools return false, different bodies return false.
  - **Test:** 5 assertions minimum
  - **Commit:** `test(util): add permission pattern overlap tests`
  - **Agent:** `tdd-developer`

- [ ] **1.2** Test tool overlap logic
  - **File:** `test/util/patterns.test.ts` (modify)
  - **Action:** Add `describe("toolsOverlap")` block. Test cases: wildcard `["*"]` overlaps any array, `undefined` defaults to wildcard and overlaps, disjoint arrays return false, overlapping arrays return true.
  - **Test:** 4 assertions minimum
  - **Commit:** `test(util): add tool overlap tests`
  - **Agent:** `tdd-developer`

- [ ] **1.3** Test integrity hash determinism and format
  - **File:** `test/util/integrity.test.ts` (create)
  - **Action:** Create test file with `describe("computeIntegrity")` block. Test cases: same input produces same hash (deterministic), output matches `sha256-[a-f0-9]{12}` format, different inputs produce different hashes.
  - **Test:** 3 assertions minimum
  - **Commit:** `test(util): add integrity hash tests`
  - **Agent:** `tdd-developer`

- [ ] **1.4** Run full test suite, verify no regressions
  - **Action:** Run `bun test`, confirm all existing 16 tests + new tests pass
  - **Commit:** (no commit — verification step)
  - **Agent:** `tdd-developer`

- [ ] **1.5** Create PR for Task 1.0
  - **Action:** Create PR with all commits, verify CI green
  - **Agent:** Manual review + merge

---

### 2.0 Unit Tests for Lockfile and Rebuild
**Agent:** `tdd-developer`
**PR:** `#2 - Phase 1.2: Unit tests for lockfile and rebuild`
**Effort:** Medium
**Depends on:** (none)

- [ ] **2.1** Test lockfile creation and defaults
  - **File:** `test/lockfile.test.ts` (create)
  - **Action:** Create test file with `describe("createDefaultLockfile")`. Test cases: default returns `lockfileVersion: 1`, `platforms: ["claude-code"]`, empty `installed` and `resolvedOrder`; custom platforms `["claude-code", "cursor"]` respected.
  - **Test:** 2 assertions minimum
  - **Commit:** `test(lockfile): add default lockfile creation tests`
  - **Agent:** `tdd-developer`

- [ ] **2.2** Test lockfile write and read round-trip
  - **File:** `test/lockfile.test.ts` (modify)
  - **Action:** Add `describe("writeLockfile / readLockfile")` block using `fs.mkdtemp` for temp dir. Test cases: write then read returns identical object; parent directories created automatically; file path is `<cwd>/.uhr/uhr.lock.json`.
  - **Test:** 2 assertions minimum
  - **Commit:** `test(lockfile): add read/write round-trip tests`
  - **Agent:** `tdd-developer`

- [ ] **2.3** Test reading non-existent lockfile returns default
  - **File:** `test/lockfile.test.ts` (modify)
  - **Action:** Add test: `readLockfile("project", freshTmpDir)` returns default lockfile with `lockfileVersion: 1`, not an error.
  - **Test:** 1 assertion minimum
  - **Commit:** `test(lockfile): test missing lockfile fallback`
  - **Agent:** `tdd-developer`

- [ ] **2.4** Test rebuild from empty lockfile
  - **File:** `test/rebuild.test.ts` (create)
  - **Action:** Create test file. Build empty lockfile with `platforms: ["claude-code"]`, call `rebuildFromLockfile(lockfile, tmpDir)`. Verify: `.claude/settings.json` created, contains `_managedBy: "uhr"`, hooks object is empty or has no entries.
  - **Test:** 3 assertions minimum
  - **Commit:** `test(rebuild): add empty lockfile rebuild test`
  - **Agent:** `tdd-developer`

- [ ] **2.5** Test rebuild with installed service produces correct config
  - **File:** `test/rebuild.test.ts` (modify)
  - **Action:** Build lockfile with one installed service (afterToolExecution hook with tools `["write", "edit"]`), populate `resolvedOrder`. Call `rebuildFromLockfile`. Verify: `PostToolUse` key exists in output, entry has `matcher: "Edit|Write"`, command matches.
  - **Test:** 3 assertions minimum
  - **Commit:** `test(rebuild): add service rebuild verification`
  - **Agent:** `tdd-developer`

- [ ] **2.6** Test rebuild warns on unmapped events
  - **File:** `test/rebuild.test.ts` (modify)
  - **Action:** Build lockfile with `afterModelResponse` hook (unmapped in Claude adapter). Verify: `warnings` array is non-empty, warning message references the unmapped event.
  - **Test:** 2 assertions minimum
  - **Commit:** `test(rebuild): add unmapped event warning test`
  - **Agent:** `tdd-developer`

- [ ] **2.7** Run full test suite, verify no regressions
  - **Action:** Run `bun test`, confirm all tests pass
  - **Commit:** (no commit — verification step)
  - **Agent:** `tdd-developer`

- [ ] **2.8** Create PR for Task 2.0
  - **Action:** Create PR with all commits, verify CI green
  - **Agent:** Manual review + merge

---

### 3.0 Integration Tests: Happy Path Pipeline
**Agent:** `tdd-developer`
**PR:** `#3 - Phase 1.3: Integration tests for happy path pipeline`
**Effort:** Large
**Depends on:** PR #1, PR #2

- [ ] **3.1** Create shared test helpers module
  - **File:** `test/integration/helpers.ts` (create)
  - **Action:** Create helper module with: `makeTmpDir()` — creates isolated temp dir via `fs.mkdtemp`; `writeManifest(dir, manifest)` — writes a manifest JSON file; `readJsonFile(path)` — reads and parses JSON; `runCli(args, cwd)` — calls `runCli()` from `src/cli.ts` with `process.cwd()` overridden to temp dir (or use `process.chdir`). Also export sample manifest builders: `formatterManifest()`, `linterManifest()`, `securityManifest()`.
  - **Commit:** `test(integration): add shared test helpers and fixtures`
  - **Agent:** `tdd-developer`

- [ ] **3.2** Test E1: Init → Install → List → Doctor happy path
  - **File:** `test/integration/pipeline.test.ts` (create)
  - **Action:** Full pipeline test in temp dir: init → write manifest → install → verify lockfile has service → verify `.claude/settings.json` structure (PostToolUse, matcher, permissions) → verify `.uhr/services/` has stored manifest → list shows service → doctor reports no issues.
  - **Test:** 8+ assertions
  - **Commit:** `test(integration): add init-install-list-doctor happy path`
  - **Agent:** `tdd-developer`

- [ ] **3.3** Test E2: Multi-service install with ordering
  - **File:** `test/integration/pipeline.test.ts` (modify)
  - **Action:** Install `test-linter` (beforeToolExecution), then install `test-security` with `runAfter: ["test-linter/lint-check"]`. Verify: lockfile `resolvedOrder.beforeToolExecution` has linter before security; `.claude/settings.json` `PreToolUse` array respects order; list shows both services.
  - **Test:** 4+ assertions
  - **Commit:** `test(integration): add multi-service ordering test`
  - **Agent:** `tdd-developer`

- [ ] **3.4** Test E8: Update re-reads manifest
  - **File:** `test/integration/pipeline.test.ts` (modify)
  - **Action:** Install service v1.0.0, modify source manifest to v2.0.0 with additional hook, run update. Verify: lockfile shows v2.0.0, new hook appears in generated config.
  - **Test:** 3+ assertions
  - **Commit:** `test(integration): add service update test`
  - **Agent:** `tdd-developer`

- [ ] **3.5** Test E9: Rebuild deterministic regeneration
  - **File:** `test/integration/pipeline.test.ts` (modify)
  - **Action:** Install service, read generated config, delete `.claude/settings.json`, run rebuild. Verify: file recreated, hook structure matches (ignore `_generatedAt` timestamp).
  - **Test:** 3+ assertions
  - **Commit:** `test(integration): add deterministic rebuild test`
  - **Agent:** `tdd-developer`

- [ ] **3.6** Test E11: Diff preview
  - **File:** `test/integration/pipeline.test.ts` (modify)
  - **Action:** Test diff for new service (not installed) — capture stdout, verify shows hooks to add. Test diff for update — install, modify manifest, run diff, verify shows changed hooks. Note: may need to capture console.log output.
  - **Test:** 2+ assertions
  - **Commit:** `test(integration): add diff preview test`
  - **Agent:** `tdd-developer`

- [ ] **3.7** Run full test suite, verify no regressions
  - **Action:** Run `bun test`, confirm all tests pass
  - **Commit:** (no commit — verification step)
  - **Agent:** `tdd-developer`

- [ ] **3.8** Create PR for Task 3.0
  - **Action:** Create PR with all commits, verify CI green
  - **Agent:** Manual review + merge

---

### 4.0 Integration Tests: Conflict Detection
**Agent:** `reliability-engineer`
**PR:** `#4 - Phase 1.4: Integration tests for conflict detection`
**Effort:** Medium
**Depends on:** PR #1

- [ ] **4.1** Test E3: Explicit conflict blocks install
  - **File:** `test/integration/conflicts.test.ts` (create)
  - **Action:** Install `service-a`, attempt install `service-b` with `conflicts: ["service-a"]`. Verify: returns exit code 1, output mentions conflict. Then re-run with `--force`, verify: returns exit code 0, service installed.
  - **Test:** 4+ assertions
  - **Commit:** `test(integration): add explicit conflict test`
  - **Agent:** `reliability-engineer`

- [ ] **4.2** Test E4: Missing requirement blocks install
  - **File:** `test/integration/conflicts.test.ts` (modify)
  - **Action:** Attempt install `service-b` with `requires: ["service-a"]` when service-a not installed. Verify: exit code 1, "requires service-a". Then install service-a, re-attempt service-b. Verify: exit code 0.
  - **Test:** 3+ assertions
  - **Commit:** `test(integration): add missing requirement test`
  - **Agent:** `reliability-engineer`

- [ ] **4.3** Test E5: Permission contradiction
  - **File:** `test/integration/conflicts.test.ts` (modify)
  - **Action:** Install `service-a` with `permissions: { deny: ["Bash(rm *)"] }`, attempt install `service-b` with `permissions: { allow: ["Bash(rm -rf *)"] }`. Verify: exit code 1, permission contradiction message includes both patterns.
  - **Test:** 2+ assertions
  - **Commit:** `test(integration): add permission contradiction test`
  - **Agent:** `reliability-engineer`

- [ ] **4.4** Test E10: Check dry-run has no side effects
  - **File:** `test/integration/conflicts.test.ts` (modify)
  - **Action:** Install `service-a`, create conflicting `service-b.json`, run `check service-b.json`. Verify: conflict reported, exit code 1. Read lockfile after — still only `service-a` installed. Config unchanged.
  - **Test:** 3+ assertions
  - **Commit:** `test(integration): add check dry-run side-effect test`
  - **Agent:** `reliability-engineer`

- [ ] **4.5** Run full test suite, verify no regressions
  - **Action:** Run `bun test`, confirm all tests pass
  - **Commit:** (no commit — verification step)
  - **Agent:** `reliability-engineer`

- [ ] **4.6** Create PR for Task 4.0
  - **Action:** Create PR with all commits, verify CI green
  - **Agent:** Manual review + merge

---

### 5.0 Integration Tests: Uninstall Flows
**Agent:** `tdd-developer`
**PR:** `#5 - Phase 1.5: Integration tests for uninstall flows`
**Effort:** Small
**Depends on:** PR #3

- [ ] **5.1** Test E6: Clean uninstall removes service fully
  - **File:** `test/integration/uninstall.test.ts` (create)
  - **Action:** Install `service-a` and `service-b`. Uninstall `service-a`. Verify: exit code 0, lockfile has only `service-b`, `.claude/settings.json` has only service-b hooks, `.uhr/services/service-a.json` deleted.
  - **Test:** 4+ assertions
  - **Commit:** `test(integration): add clean uninstall test`
  - **Agent:** `tdd-developer`

- [ ] **5.2** Test E7: Uninstall blocked by dependent service
  - **File:** `test/integration/uninstall.test.ts` (modify)
  - **Action:** Install `service-a`, install `service-b` with `requires: ["service-a"]` (force). Attempt uninstall `service-a`. Verify: exit code 1, message includes "required by: service-b".
  - **Test:** 2+ assertions
  - **Commit:** `test(integration): add uninstall blocker test`
  - **Agent:** `tdd-developer`

- [ ] **5.3** Run full test suite, verify no regressions
  - **Action:** Run `bun test`, confirm all tests pass
  - **Commit:** (no commit — verification step)
  - **Agent:** `tdd-developer`

- [ ] **5.4** Create PR for Task 5.0
  - **Action:** Create PR with all commits, verify CI green
  - **Agent:** Manual review + merge

---

### 6.0 Error Handling Tests
**Agent:** `reliability-engineer`
**PR:** `#6 - Phase 1.6: Error handling tests`
**Effort:** Small
**Depends on:** (none)

- [ ] **6.1** Test ERR1: Invalid manifest inputs
  - **File:** `test/cli-errors.test.ts` (create)
  - **Action:** Test `loadManifest` or `validateManifest` with: empty object `{}` (throws about missing name), blocking+background hook (throws "cannot be both"), non-existent file path (throws file not found), invalid JSON content (throws parse error).
  - **Test:** 4+ assertions
  - **Commit:** `test(cli): add invalid manifest error tests`
  - **Agent:** `reliability-engineer`

- [ ] **6.2** Test ERR2: CLI edge cases
  - **File:** `test/cli-errors.test.ts` (modify)
  - **Action:** Test `runCli` with: unknown command `["foobar"]` returns 1; missing arg `["install"]` returns 1; unknown flag `["install", "foo.json", "--unknown"]` returns 1; invalid platform `["init", "--platforms=foo"]` returns 1.
  - **Test:** 4+ assertions
  - **Commit:** `test(cli): add CLI error handling tests`
  - **Agent:** `reliability-engineer`

- [ ] **6.3** Run full test suite, verify no regressions
  - **Action:** Run `bun test`, confirm all tests pass
  - **Commit:** (no commit — verification step)
  - **Agent:** `reliability-engineer`

- [ ] **6.4** Create PR for Task 6.0
  - **Action:** Create PR with all commits, verify CI green
  - **Agent:** Manual review + merge

---

### 7.0 Claude Code Adapter Validation + Doctor Integration
**Agent:** `tdd-developer`
**PR:** `#7 - Phase 1.7: Adapter validation and doctor integration tests`
**Effort:** Medium
**Depends on:** PR #2

- [ ] **7.1** Test A1: Full generated config structure validation
  - **File:** `test/adapters/claude-code-full.test.ts` (create)
  - **Action:** Build lockfile with service having hooks on 5 events (beforeToolExecution, afterToolExecution, stop, sessionStart, beforePromptSubmit) with tools (write, edit, bash). Generate via Claude adapter. Verify: all 5 event mappings correct (PreToolUse, PostToolUse, Stop, SessionStart, UserPromptSubmit); tool matcher format `"Bash|Edit|Write"` (sorted, pipe-separated); hook entry has `{ matcher, _uhrSource, hooks: [{ type: "command", command }] }`; permissions.allowedTools aggregated; `_managedBy`, `_generatedAt`, `_warning` metadata present.
  - **Test:** 8+ assertions
  - **Commit:** `test(adapter): add full Claude Code config structure validation`
  - **Agent:** `tdd-developer`

- [ ] **7.2** Test A2: Unmapped events produce warnings not errors
  - **File:** `test/adapters/claude-code-full.test.ts` (modify)
  - **Action:** Build lockfile with `afterModelResponse` hook (unmapped) alongside `sessionStart` (mapped). Generate via adapter. Verify: warnings array has entry about unmapped event, `SessionStart` hooks still generated correctly, no error thrown.
  - **Test:** 3+ assertions
  - **Commit:** `test(adapter): add unmapped event warning validation`
  - **Agent:** `tdd-developer`

- [ ] **7.3** Test E12: Doctor issue detection (integration)
  - **File:** `test/integration/doctor.test.ts` (create)
  - **Action:** Test doctor in temp dirs with various issues: (1) Missing lockfile → warning; (2) Install service, overwrite lockfile `generatedAt` to future date → stale config warning; (3) Write invalid JSON to `.claude/settings.json` → invalid JSON warning; (4) Modify stored manifest after install → integrity mismatch warning; (5) Run with `--json` flag → valid JSON output with `issues` array.
  - **Test:** 5+ assertions
  - **Commit:** `test(integration): add doctor issue detection tests`
  - **Agent:** `tdd-developer`

- [ ] **7.4** Run full test suite, verify no regressions
  - **Action:** Run `bun test`, confirm all tests pass
  - **Commit:** (no commit — verification step)
  - **Agent:** `tdd-developer`

- [ ] **7.5** Create PR for Task 7.0
  - **Action:** Create PR with all commits, verify CI green
  - **Agent:** Manual review + merge

---

## Summary

**Total Tasks:** 33 sub-tasks across 7 parent tasks
**Total PRs:** 7 PRs (one per parent task)
**Total New Tests:** 20 test cases, 60+ new assertions

**Agent Assignments:**
- `tdd-developer`: 70% of tasks (standard test-first development)
- `reliability-engineer`: 30% of tasks (conflict detection, error handling — safety-critical paths)

**Critical Path:**
```
PR #1 (utilities) ─┬─ PR #3 (happy path) ── PR #5 (uninstall)
PR #2 (lockfile)  ─┘
PR #2 (lockfile)  ─── PR #7 (adapter + doctor)
PR #1 (utilities) ─── PR #4 (conflicts)
PR #6 (errors)        (independent)
```

**Parallel Work:**
- PR #1, PR #2, PR #6 can all run in parallel (wave 1)
- PR #3, PR #4, PR #7 can run in parallel once their deps are met (wave 2)
- PR #5 runs last (depends on PR #3)

**Current baseline:** 16 tests, 30 assertions
**Target after completion:** 36+ tests, 90+ assertions

---

*Task list generated 2026-02-07 by tasklist-generator skill*
