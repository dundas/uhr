import { describe, expect, test } from "bun:test";
import { codexAdapter } from "../../src/adapters/codex";
import { createDefaultLockfile } from "../../src/lockfile";
import type { UhrLockfile } from "../../src/types";

function lockfile(): UhrLockfile {
  return {
    lockfileVersion: 2,
    generatedAt: "2026-09-03T00:00:00.000Z",
    generatedBy: "uhr@test",
    platforms: ["codex"],
    installed: {
      presence: {
        version: "1.0.0",
        installedAt: "2026-09-03T00:00:00.000Z",
        integrity: "sha256-test",
        source: "local:test.json",
        hooks: [
          { id: "start", on: "sessionStart", command: "writer", timeout: 2000, background: true },
          { id: "permission", on: "permissionRequest", command: "approve", tools: ["bash", "write"], blocking: true, timeout: 8000 },
          { id: "end", on: "sessionEnd", command: "writer end", timeout: 9000, background: true },
          { id: "unsupported", on: "notification", command: "notify" },
          { id: "unhookable", on: "beforeToolExecution", command: "read", tools: ["fetch"] }
        ]
      }
    },
    resolvedOrder: {
      sessionStart: ["presence/start"],
      permissionRequest: ["presence/permission"],
      sessionEnd: ["presence/end"],
      notification: ["presence/unsupported"],
      beforeToolExecution: ["presence/unhookable"]
    },
    mergeMode: "preserve"
  };
}

describe("codexAdapter", () => {
  test("emits current Codex hooks.json shape and supported execution semantics", () => {
    const output = codexAdapter.generate(lockfile(), "/tmp/project");
    expect(output.filepath).toBe("/tmp/project/.codex/hooks.json");

    const content = output.content as Record<string, unknown>;
    expect(Object.keys(content).sort()).toEqual(["description", "hooks"]);
    expect(JSON.stringify(content)).not.toContain("_uhr");
    expect(JSON.stringify(content)).not.toContain("_managedBy");

    const hooks = content.hooks as Record<string, Array<Record<string, unknown>>>;
    expect(hooks.SessionStart[0]).toEqual({
      hooks: [{ type: "command", command: "writer", timeout: 2, async: true }]
    });
    expect(hooks.PermissionRequest[0]).toEqual({
      matcher: "Bash|Write",
      hooks: [{ type: "command", command: "approve", timeout: 8 }]
    });
  });

  test("warns instead of inventing unsupported events, tools, or SessionEnd background semantics", () => {
    const output = codexAdapter.generate(lockfile(), "/tmp/project");
    const messages = output.warnings.map((warning) => `${warning.hookId}: ${warning.message}`).join("\n");
    expect(messages).toContain("presence/unsupported");
    expect(messages).toContain("notification");
    expect(messages).toContain("presence/unhookable");
    expect(messages).toContain("fetch");
    expect(messages).toContain("SessionEnd");
    expect(messages).toContain("synchronously");

    const hooks = (output.content as { hooks: Record<string, Array<{ hooks: Array<Record<string, unknown>> }>> }).hooks;
    expect(hooks.Notification).toBeUndefined();
    expect(hooks.PreToolUse).toBeUndefined();
    expect(hooks.SessionEnd[0].hooks[0]).toEqual({ type: "command", command: "writer end", timeout: 3 });
  });

  test("does not reinterpret tool filters as lifecycle matchers", () => {
    const lockfile = createDefaultLockfile(["codex"]);
    lockfile.installed.service = {
      version: "1.0.0",
      installedAt: lockfile.generatedAt,
      integrity: "sha256-test",
      source: "local:/missing",
      hooks: [{ id: "start", on: "sessionStart", command: "start", tools: ["bash"] }]
    };
    lockfile.resolvedOrder = { sessionStart: ["service/start"] };

    const output = codexAdapter.generate(lockfile, "/tmp/project");

    expect((output.content as { hooks: Record<string, unknown[]> }).hooks.SessionStart).toBeUndefined();
    expect(output.warnings.some((warning) => warning.message.includes("omitted to avoid broadening"))).toBe(true);
  });

  test("rounds universal millisecond timeouts up to positive whole seconds", () => {
    const lockfile = createDefaultLockfile(["codex"]);
    lockfile.installed.service = {
      version: "1.0.0",
      installedAt: lockfile.generatedAt,
      integrity: "sha256-test",
      source: "local:/missing",
      hooks: [
        { id: "one-ms", on: "beforeToolExecution", command: "one", timeout: 1 },
        { id: "subsecond", on: "beforeToolExecution", command: "subsecond", timeout: 999 },
        { id: "fractional", on: "beforeToolExecution", command: "fractional", timeout: 1500 },
        { id: "end", on: "sessionEnd", command: "end", timeout: 3001 }
      ]
    };
    lockfile.resolvedOrder = {
      beforeToolExecution: ["service/one-ms", "service/subsecond", "service/fractional"],
      sessionEnd: ["service/end"]
    };

    const output = codexAdapter.generate(lockfile, "/tmp/project");
    const hooks = (output.content as { hooks: Record<string, Array<{ hooks: Array<{ timeout: number }> }>> }).hooks;

    expect(hooks.PreToolUse.map((group) => group.hooks[0].timeout)).toEqual([1, 1, 2]);
    expect(hooks.SessionEnd[0].hooks[0].timeout).toBe(3);
    const messages = output.warnings.map((warning) => `${warning.hookId}: ${warning.message}`).join("\n");
    expect(messages).toContain("service/one-ms");
    expect(messages).toContain("service/subsecond");
    expect(messages).toContain("service/fractional");
    expect(messages).toContain("rounded up");
    expect(messages).toContain("service/end");
    expect(messages).toContain("clamped");
  });
});
