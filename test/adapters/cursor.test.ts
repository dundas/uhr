import { describe, expect, test } from "bun:test";
import { cursorAdapter } from "../../src/adapters/cursor";
import { createDefaultLockfile } from "../../src/lockfile";
import type { UhrLockfile, PlatformId, UniversalEvent } from "../../src/types";

describe("cursorAdapter", () => {
  test("warns on unsupported beforeToolExecution non-shell mapping", () => {
    const lockfile = createDefaultLockfile(["cursor"]);
    lockfile.installed.service = {
      version: "1.0.0",
      installedAt: new Date().toISOString(),
      integrity: "sha256-a",
      source: "local:/tmp/svc.json",
      hooks: [{ id: "h1", on: "beforeToolExecution", tools: ["write"], command: "echo hi" }]
    };
    lockfile.resolvedOrder.beforeToolExecution = ["service/h1"];

    const output = cursorAdapter.generate(lockfile, "/tmp/project");
    const config = output.content as {
      _generatedAt: string;
      hooks: Record<string, Array<{ command: string }>>;
    };

    expect(output.warnings.length).toBeGreaterThan(0);
    expect(output.filepath).toBe("/tmp/project/.cursor/hooks.json");
    expect(config._generatedAt).toBe(lockfile.generatedAt);
  });

  test("maps afterToolExecution write hooks to afterFileEdit", () => {
    const lockfile = createDefaultLockfile(["cursor"]);
    lockfile.installed.service = {
      version: "1.0.0",
      installedAt: new Date().toISOString(),
      integrity: "sha256-a",
      source: "local:/tmp/svc.json",
      hooks: [{ id: "h1", on: "afterToolExecution", tools: ["write"], command: "format" }]
    };
    lockfile.resolvedOrder.afterToolExecution = ["service/h1"];

    const output = cursorAdapter.generate(lockfile, "/tmp/project");
    const config = output.content as { hooks: Record<string, Array<{ command: string }>> };

    expect(config.hooks.afterFileEdit).toHaveLength(1);
    expect(config.hooks.afterFileEdit[0]?.command).toBe("format");
    expect(output.warnings).toHaveLength(0);
  });

  test("excludes hooks targeting other platforms", () => {
    const lockfile: UhrLockfile = {
      lockfileVersion: 2,
      generatedAt: new Date().toISOString(),
      generatedBy: "uhr@test",
      platforms: ["cursor"] as PlatformId[],
      installed: {
        svc: {
          version: "1.0.0",
          installedAt: new Date().toISOString(),
          integrity: "sha256-a",
          source: "local:/tmp/svc.json",
          hooks: [
            { id: "cursor-hook", on: "stop" as UniversalEvent, command: "cursor-stop", platforms: ["cursor"] },
            { id: "claude-hook", on: "stop" as UniversalEvent, command: "claude-stop", platforms: ["claude-code"] },
            { id: "universal", on: "stop" as UniversalEvent, command: "all-stop" },
          ]
        }
      },
      resolvedOrder: { stop: ["svc/cursor-hook", "svc/claude-hook", "svc/universal"] },
      mergeMode: "strict"
    };

    const output = cursorAdapter.generate(lockfile, "/tmp/project");
    const config = output.content as { hooks: Record<string, Array<{ command: string }>> };

    const stopCommands = config.hooks.stop.map((h) => h.command);
    expect(stopCommands).toContain("cursor-stop");
    expect(stopCommands).not.toContain("claude-stop");
    expect(stopCommands).toContain("all-stop");
  });
});
