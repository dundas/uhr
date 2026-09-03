import { describe, expect, test } from "bun:test";
import { claudeCodeAdapter } from "../../src/adapters/claude-code";
import { createDefaultLockfile } from "../../src/lockfile";
import type { UhrLockfile } from "../../src/types";

describe("claudeCodeAdapter", () => {
  test("generates target path", () => {
    const output = claudeCodeAdapter.generate(createDefaultLockfile(), "/tmp/project");
    expect(output.filepath).toBe("/tmp/project/.claude/settings.json");
  });

  test("preserves supported timeout and background semantics without promising an async timeout", () => {
    const lockfile: UhrLockfile = {
      ...createDefaultLockfile(["claude-code"]),
      installed: {
        service: {
          version: "1.0.0",
          installedAt: "2026-09-03T00:00:00.000Z",
          integrity: "sha256-test",
          source: "local:test.json",
          hooks: [
            { id: "observe", on: "sessionStart", command: "observe", timeout: 4000, background: true },
            { id: "gate", on: "beforeToolExecution", command: "gate", timeout: 7000, blocking: true }
          ]
        }
      },
      resolvedOrder: { sessionStart: ["service/observe"], beforeToolExecution: ["service/gate"] }
    };
    const output = claudeCodeAdapter.generate(lockfile, "/tmp/project");
    const handler = (output.content as { hooks: { SessionStart: Array<{ hooks: unknown[] }> } }).hooks.SessionStart[0].hooks[0];
    expect(handler).toEqual({ type: "command", command: "observe", async: true });
    const gate = (output.content as { hooks: { PreToolUse: Array<{ hooks: unknown[] }> } }).hooks.PreToolUse[0].hooks[0];
    expect(gate).toEqual({ type: "command", command: "gate", timeout: 7 });
    expect(output.warnings.some((warning) => warning.message.includes("does not enforce timeout"))).toBe(true);
  });
});
