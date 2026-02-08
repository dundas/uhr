import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createDefaultLockfile } from "../src/lockfile";
import { rebuildFromLockfile } from "../src/rebuild";
import type { PlatformId, UhrLockfile } from "../src/types";

let tmpDir: string | undefined;

afterEach(async () => {
  if (tmpDir) {
    await rm(tmpDir, { recursive: true, force: true });
    tmpDir = undefined;
  }
});

describe("rebuildFromLockfile", () => {
  test("empty lockfile produces settings with _managedBy uhr", async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "uhr-rebuild-test-"));

    const lockfile: UhrLockfile = {
      ...createDefaultLockfile(),
      generatedAt: new Date().toISOString(),
      generatedBy: "uhr@test"
    };

    const result = await rebuildFromLockfile(lockfile, tmpDir);

    const settingsPath = result.writtenFiles.find((f) => f.endsWith(".claude/settings.json"));
    expect(settingsPath).toBeDefined();

    const content = await Bun.file(settingsPath!).json();
    expect(content._managedBy).toBe("uhr");
  });

  test("lockfile with one service produces correct platform hooks", async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "uhr-rebuild-test-"));

    const lockfile: UhrLockfile = {
      lockfileVersion: 2,
      generatedAt: new Date().toISOString(),
      generatedBy: "uhr@test",
      platforms: ["claude-code"] as PlatformId[],
      installed: {
        "test-svc": {
          version: "1.0.0",
          installedAt: new Date().toISOString(),
          integrity: "sha256-abc123def456",
          source: "local:/tmp/test.json",
          hooks: [
            {
              id: "fmt",
              on: "afterToolExecution",
              command: "prettier --write",
              tools: ["write", "edit"]
            }
          ]
        }
      },
      resolvedOrder: {
        afterToolExecution: ["test-svc/fmt"]
      },
      mergeMode: "strict"
    };

    const result = await rebuildFromLockfile(lockfile, tmpDir);

    const settingsPath = result.writtenFiles.find((f) => f.endsWith(".claude/settings.json"));
    expect(settingsPath).toBeDefined();

    const content = await Bun.file(settingsPath!).json();

    expect(content.hooks).toBeDefined();
    expect(content.hooks.PostToolUse).toBeDefined();
    expect(content.hooks.PostToolUse).toBeArray();
    expect(content.hooks.PostToolUse.length).toBe(1);

    const entry = content.hooks.PostToolUse[0];
    expect(entry.matcher).toContain("Edit");
    expect(entry.matcher).toContain("Write");
    expect(entry.hooks[0].command).toBe("prettier --write");
  });

  test("unmapped events produce warnings", async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "uhr-rebuild-test-"));

    const lockfile: UhrLockfile = {
      lockfileVersion: 2,
      generatedAt: new Date().toISOString(),
      generatedBy: "uhr@test",
      platforms: ["claude-code"] as PlatformId[],
      installed: {
        "warn-svc": {
          version: "1.0.0",
          installedAt: new Date().toISOString(),
          integrity: "sha256-xyz",
          source: "local:/tmp/warn.json",
          hooks: [
            {
              id: "respond",
              on: "afterModelResponse",
              command: "echo response"
            }
          ]
        }
      },
      resolvedOrder: {
        afterModelResponse: ["warn-svc/respond"]
      },
      mergeMode: "strict"
    };

    const result = await rebuildFromLockfile(lockfile, tmpDir);

    expect(result.warnings).toBeArray();
    expect(result.warnings.length).toBeGreaterThan(0);

    const unmappedWarning = result.warnings.find((w) =>
      w.message.includes("afterModelResponse")
    );
    expect(unmappedWarning).toBeDefined();
  });
});

describe("preserve-mode merge", () => {
  test("preserve mode keeps unmanaged hooks alongside UHR-managed hooks", async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "uhr-rebuild-test-"));

    // Write a pre-existing settings.json with a manual hook
    const settingsDir = path.join(tmpDir, ".claude");
    await import("node:fs/promises").then((fs) => fs.mkdir(settingsDir, { recursive: true }));
    await Bun.write(
      path.join(settingsDir, "settings.json"),
      JSON.stringify({
        hooks: {
          PreToolUse: [
            { matcher: "Bash", hooks: [{ type: "command", command: "manual-check" }] }
          ]
        },
        permissions: { allowedTools: ["Read(*)"] }
      })
    );

    const lockfile: UhrLockfile = {
      lockfileVersion: 2,
      generatedAt: new Date().toISOString(),
      generatedBy: "uhr@test",
      platforms: ["claude-code"] as PlatformId[],
      installed: {
        "test-svc": {
          version: "1.0.0",
          installedAt: new Date().toISOString(),
          integrity: "sha256-abc",
          source: "local:/tmp/test.json",
          hooks: [
            { id: "fmt", on: "beforeToolExecution", command: "uhr-fmt", tools: ["write"] }
          ],
          permissions: { allow: ["Bash(npm *)"] }
        }
      },
      resolvedOrder: {
        beforeToolExecution: ["test-svc/fmt"]
      },
      mergeMode: "preserve"
    };

    const result = await rebuildFromLockfile(lockfile, tmpDir);
    const settingsPath = result.writtenFiles.find((f) => f.endsWith(".claude/settings.json"));
    const content = await Bun.file(settingsPath!).json();

    // Should have both the manual hook and the UHR hook
    expect(content.hooks.PreToolUse).toBeArray();
    expect(content.hooks.PreToolUse.length).toBe(2);

    const manualHook = content.hooks.PreToolUse.find(
      (h: Record<string, unknown>) => !h._uhrSource
    );
    const uhrHook = content.hooks.PreToolUse.find(
      (h: Record<string, unknown>) => h._uhrSource === "test-svc/fmt"
    );
    expect(manualHook.hooks[0].command).toBe("manual-check");
    expect(uhrHook.hooks[0].command).toBe("uhr-fmt");

    // Permissions should be merged
    expect(content.permissions.allowedTools).toContain("Read(*)");
    expect(content.permissions.allowedTools).toContain("Bash(npm *)");
  });

  test("strict mode overwrites existing config entirely", async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "uhr-rebuild-test-"));

    const settingsDir = path.join(tmpDir, ".claude");
    await import("node:fs/promises").then((fs) => fs.mkdir(settingsDir, { recursive: true }));
    await Bun.write(
      path.join(settingsDir, "settings.json"),
      JSON.stringify({
        hooks: {
          PreToolUse: [
            { matcher: "Bash", hooks: [{ type: "command", command: "manual-check" }] }
          ]
        }
      })
    );

    const lockfile: UhrLockfile = {
      lockfileVersion: 2,
      generatedAt: new Date().toISOString(),
      generatedBy: "uhr@test",
      platforms: ["claude-code"] as PlatformId[],
      installed: {},
      resolvedOrder: {},
      mergeMode: "strict"
    };

    const result = await rebuildFromLockfile(lockfile, tmpDir);
    const settingsPath = result.writtenFiles.find((f) => f.endsWith(".claude/settings.json"));
    const content = await Bun.file(settingsPath!).json();

    // Strict mode: the manual hook should be gone
    expect(content.hooks).toEqual({});
  });
});
