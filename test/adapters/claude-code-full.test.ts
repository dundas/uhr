import { describe, expect, test } from "bun:test";
import { claudeCodeAdapter } from "../../src/adapters/claude-code";
import type { UhrLockfile, PlatformId, UniversalEvent } from "../../src/types";

// ──────────────────────────────────────────────────────────────────────
// Test A1: Full config structure validation
// ──────────────────────────────────────────────────────────────────────

describe("claudeCodeAdapter full config structure", () => {
  const lockfile: UhrLockfile = {
    lockfileVersion: 1,
    generatedAt: new Date().toISOString(),
    generatedBy: "uhr@test",
    platforms: ["claude-code"] as PlatformId[],
    installed: {
      "multi-hook-svc": {
        version: "1.0.0",
        installedAt: new Date().toISOString(),
        integrity: "sha256-test123test",
        source: "local:/tmp/test.json",
        hooks: [
          { id: "pre-tool", on: "beforeToolExecution" as UniversalEvent, command: "check-tool", tools: ["write", "edit", "bash"] },
          { id: "post-tool", on: "afterToolExecution" as UniversalEvent, command: "log-tool", tools: ["write"] },
          { id: "on-stop", on: "stop" as UniversalEvent, command: "cleanup" },
          { id: "on-start", on: "sessionStart" as UniversalEvent, command: "init-session" },
          { id: "on-prompt", on: "beforePromptSubmit" as UniversalEvent, command: "validate-prompt" },
        ],
        permissions: { allow: ["Bash(npm *)", "Read(*)"] },
      },
    },
    resolvedOrder: {
      beforeToolExecution: ["multi-hook-svc/pre-tool"],
      afterToolExecution: ["multi-hook-svc/post-tool"],
      stop: ["multi-hook-svc/on-stop"],
      sessionStart: ["multi-hook-svc/on-start"],
      beforePromptSubmit: ["multi-hook-svc/on-prompt"],
    },
  };

  const output = claudeCodeAdapter.generate(lockfile, "/tmp/test-project");
  const content = output.content as Record<string, unknown>;
  const hooks = content.hooks as Record<string, unknown[]>;

  test("event mappings: output has all five expected platform event keys", () => {
    expect(hooks).toHaveProperty("PreToolUse");
    expect(hooks).toHaveProperty("PostToolUse");
    expect(hooks).toHaveProperty("Stop");
    expect(hooks).toHaveProperty("SessionStart");
    expect(hooks).toHaveProperty("UserPromptSubmit");
  });

  test("tool matcher for pre-tool: contains Bash|Edit|Write pipe-separated sorted", () => {
    const preToolEntries = hooks.PreToolUse as Array<{ matcher: string }>;
    expect(preToolEntries).toHaveLength(1);
    expect(preToolEntries[0].matcher).toBe("Bash|Edit|Write");
  });

  test("tool matcher for post-tool (single tool write): is Write", () => {
    const postToolEntries = hooks.PostToolUse as Array<{ matcher: string }>;
    expect(postToolEntries).toHaveLength(1);
    expect(postToolEntries[0].matcher).toBe("Write");
  });

  test("hook entry structure has matcher, _uhrSource, and hooks array with command", () => {
    const preToolEntries = hooks.PreToolUse as Array<{
      matcher: string;
      _uhrSource: string;
      hooks: Array<{ type: string; command: string }>;
    }>;
    const entry = preToolEntries[0];

    expect(typeof entry.matcher).toBe("string");
    expect(entry._uhrSource).toBe("multi-hook-svc/pre-tool");
    expect(Array.isArray(entry.hooks)).toBe(true);
    expect(entry.hooks).toHaveLength(1);
    expect(entry.hooks[0].type).toBe("command");
    expect(entry.hooks[0].command).toBe("check-tool");
  });

  test("permissions: allowedTools includes both permission strings", () => {
    const permissions = content.permissions as { allowedTools: string[] };
    expect(permissions.allowedTools).toContain("Bash(npm *)");
    expect(permissions.allowedTools).toContain("Read(*)");
  });

  test("metadata: _managedBy is uhr, _generatedAt and _warning exist", () => {
    expect(content._managedBy).toBe("uhr");
    expect(typeof content._generatedAt).toBe("string");
    expect(content._generatedAt).toBe(lockfile.generatedAt);
    expect(typeof content._warning).toBe("string");
    expect((content._warning as string).length).toBeGreaterThan(0);
  });

  test("filepath ends with .claude/settings.json", () => {
    expect(output.filepath).toBe("/tmp/test-project/.claude/settings.json");
    expect(output.filepath.endsWith(".claude/settings.json")).toBe(true);
  });

  test("no warnings for fully mapped events", () => {
    expect(output.warnings).toHaveLength(0);
  });

  test("events without tools produce empty matcher string", () => {
    const stopEntries = hooks.Stop as Array<{ matcher: string }>;
    expect(stopEntries).toHaveLength(1);
    expect(stopEntries[0].matcher).toBe("");

    const sessionStartEntries = hooks.SessionStart as Array<{ matcher: string }>;
    expect(sessionStartEntries).toHaveLength(1);
    expect(sessionStartEntries[0].matcher).toBe("");
  });
});

// ──────────────────────────────────────────────────────────────────────
// Test A2: Unmapped events produce warnings
// ──────────────────────────────────────────────────────────────────────

describe("claudeCodeAdapter unmapped event warnings", () => {
  const lockfile: UhrLockfile = {
    lockfileVersion: 1,
    generatedAt: new Date().toISOString(),
    generatedBy: "uhr@test",
    platforms: ["claude-code"] as PlatformId[],
    installed: {
      "warn-svc": {
        version: "1.0.0",
        installedAt: new Date().toISOString(),
        integrity: "sha256-test123test",
        source: "local:/tmp/test.json",
        hooks: [
          { id: "unmapped", on: "afterModelResponse" as UniversalEvent, command: "echo unmapped" },
          { id: "mapped", on: "sessionStart" as UniversalEvent, command: "echo mapped" },
        ],
      },
    },
    resolvedOrder: {
      afterModelResponse: ["warn-svc/unmapped"],
      sessionStart: ["warn-svc/mapped"],
    },
  };

  const output = claudeCodeAdapter.generate(lockfile, "/tmp/test-project");
  const content = output.content as Record<string, unknown>;
  const hooks = content.hooks as Record<string, unknown[]>;

  test("warnings is non-empty for unmapped event", () => {
    expect(output.warnings.length).toBeGreaterThan(0);
  });

  test("at least one warning message includes afterModelResponse", () => {
    const hasAfterModelResponseWarning = output.warnings.some(
      (w) => w.message.includes("afterModelResponse")
    );
    expect(hasAfterModelResponseWarning).toBe(true);
  });

  test("mapped events still produce correct hooks", () => {
    expect(hooks.SessionStart).toBeDefined();
    expect(Array.isArray(hooks.SessionStart)).toBe(true);
    const entries = hooks.SessionStart as Array<{ _uhrSource: string }>;
    expect(entries).toHaveLength(1);
    expect(entries[0]._uhrSource).toBe("warn-svc/mapped");
  });

  test("unmapped event does not appear as a hook key", () => {
    // afterModelResponse has no Claude Code mapping, so it should not create a hook key
    expect(hooks).not.toHaveProperty("afterModelResponse");
  });
});
