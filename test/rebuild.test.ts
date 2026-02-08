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
      lockfileVersion: 1,
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
      }
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
      lockfileVersion: 1,
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
      }
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
