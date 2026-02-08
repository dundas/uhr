import { describe, expect, test, beforeEach, afterEach, spyOn } from "bun:test";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runCli } from "../../src/cli";
import { writeManifest } from "./helpers";

// ──────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────

function allOutput(spy: ReturnType<typeof spyOn>): string {
  return spy.mock.calls.map((args: unknown[]) => args.join(" ")).join("\n");
}

// ──────────────────────────────────────────────────────────────────────
// Integration Tests for Conflict Detection
// ──────────────────────────────────────────────────────────────────────

describe("integration: conflict detection", () => {
  let tmpDir: string;
  let consoleLogSpy: ReturnType<typeof spyOn>;
  let consoleErrorSpy: ReturnType<typeof spyOn>;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "uhr-conflict-test-"));
    consoleLogSpy = spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(async () => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    await rm(tmpDir, { recursive: true, force: true });
  });

  // ──────────────────────────────────────────────────────────────────
  // E3: Explicit conflict blocks install
  // ──────────────────────────────────────────────────────────────────

  describe("E3: explicit conflict blocks install", () => {
    test("service with conflicts declaration is blocked from installing", async () => {
      // Step 1: Initialize project
      const initCode = await runCli(["init"], tmpDir);
      expect(initCode).toBe(0);

      // Step 2: Write and install service-a
      const serviceAPath = await writeManifest(tmpDir, {
        name: "service-a",
        version: "1.0.0",
        hooks: [{ id: "h1", on: "stop", command: "echo a" }],
      });
      const installACode = await runCli(["install", serviceAPath], tmpDir);
      expect(installACode).toBe(0);

      // Step 3: Write service-b with explicit conflict against service-a
      const serviceBPath = await writeManifest(tmpDir, {
        name: "service-b",
        version: "1.0.0",
        hooks: [{ id: "h1", on: "stop", command: "echo b" }],
        conflicts: ["service-a"],
      });

      // Step 4: Installing service-b should fail with exit code 1
      const installBCode = await runCli(["install", serviceBPath], tmpDir);
      expect(installBCode).toBe(1);

      // Step 5: Output should mention the conflict
      const combinedOutput = allOutput(consoleLogSpy) + "\n" + allOutput(consoleErrorSpy);
      expect(combinedOutput).toContain("conflicts with service-a");
    });

    test("--force overrides explicit conflict and installs both services", async () => {
      // Initialize and install service-a
      await runCli(["init"], tmpDir);
      const serviceAPath = await writeManifest(tmpDir, {
        name: "service-a",
        version: "1.0.0",
        hooks: [{ id: "h1", on: "stop", command: "echo a" }],
      });
      await runCli(["install", serviceAPath], tmpDir);

      // Write service-b with conflict
      const serviceBPath = await writeManifest(tmpDir, {
        name: "service-b",
        version: "1.0.0",
        hooks: [{ id: "h1", on: "stop", command: "echo b" }],
        conflicts: ["service-a"],
      });

      // Force install should succeed
      const forceCode = await runCli(["install", serviceBPath, "--force"], tmpDir);
      expect(forceCode).toBe(0);

      // Verify lockfile contains both services
      const lockfilePath = path.join(tmpDir, ".uhr", "uhr.lock.json");
      const lockfile = JSON.parse(await readFile(lockfilePath, "utf8"));
      expect(lockfile.installed["service-a"]).toBeDefined();
      expect(lockfile.installed["service-b"]).toBeDefined();
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // E4: Missing requirement blocks install
  // ──────────────────────────────────────────────────────────────────

  describe("E4: missing requirement blocks install", () => {
    test("service with unmet requires is blocked", async () => {
      // Initialize
      const initCode = await runCli(["init"], tmpDir);
      expect(initCode).toBe(0);

      // Write service-b that requires service-a (which is not installed)
      const serviceBPath = await writeManifest(tmpDir, {
        name: "service-b",
        version: "1.0.0",
        hooks: [{ id: "h1", on: "stop", command: "echo b" }],
        requires: ["service-a"],
      });

      // Install should fail
      const installBCode = await runCli(["install", serviceBPath], tmpDir);
      expect(installBCode).toBe(1);

      // Output should mention the missing requirement
      const combinedOutput = allOutput(consoleLogSpy) + "\n" + allOutput(consoleErrorSpy);
      expect(combinedOutput).toContain("requires service-a");
    });

    test("installing the dependency first then the dependent succeeds", async () => {
      await runCli(["init"], tmpDir);

      // Install service-a first
      const serviceAPath = await writeManifest(tmpDir, {
        name: "service-a",
        version: "1.0.0",
        hooks: [{ id: "h1", on: "stop", command: "echo a" }],
      });
      const installACode = await runCli(["install", serviceAPath], tmpDir);
      expect(installACode).toBe(0);

      // Now install service-b that requires service-a
      const serviceBPath = await writeManifest(tmpDir, {
        name: "service-b",
        version: "1.0.0",
        hooks: [{ id: "h1", on: "stop", command: "echo b" }],
        requires: ["service-a"],
      });
      const installBCode = await runCli(["install", serviceBPath], tmpDir);
      expect(installBCode).toBe(0);
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // E5: Permission contradiction
  // ──────────────────────────────────────────────────────────────────

  describe("E5: permission contradiction blocks install", () => {
    test("allow pattern overlapping with deny pattern is detected", async () => {
      // Initialize
      const initCode = await runCli(["init"], tmpDir);
      expect(initCode).toBe(0);

      // Install service-a with deny permission
      const serviceAPath = await writeManifest(tmpDir, {
        name: "service-a",
        version: "1.0.0",
        hooks: [{ id: "h1", on: "stop", command: "echo a" }],
        permissions: { deny: ["Bash(rm *)"] },
      });
      const installACode = await runCli(["install", serviceAPath], tmpDir);
      expect(installACode).toBe(0);

      // Write service-b with overlapping allow permission
      const serviceBPath = await writeManifest(tmpDir, {
        name: "service-b",
        version: "1.0.0",
        hooks: [{ id: "h1", on: "stop", command: "echo b" }],
        permissions: { allow: ["Bash(rm -rf *)"] },
      });

      // Install should fail due to permission contradiction
      const installBCode = await runCli(["install", serviceBPath], tmpDir);
      expect(installBCode).toBe(1);

      // Output should reference the permission contradiction (allows/denies)
      const combinedOutput = allOutput(consoleLogSpy) + "\n" + allOutput(consoleErrorSpy);
      expect(combinedOutput).toContain("allows");
      expect(combinedOutput).toContain("denies");
    });

    test("permission contradiction message mentions both patterns", async () => {
      await runCli(["init"], tmpDir);

      const serviceAPath = await writeManifest(tmpDir, {
        name: "service-a",
        version: "1.0.0",
        hooks: [{ id: "h1", on: "stop", command: "echo a" }],
        permissions: { deny: ["Bash(rm *)"] },
      });
      await runCli(["install", serviceAPath], tmpDir);

      const serviceBPath = await writeManifest(tmpDir, {
        name: "service-b",
        version: "1.0.0",
        hooks: [{ id: "h1", on: "stop", command: "echo b" }],
        permissions: { allow: ["Bash(rm -rf *)"] },
      });
      await runCli(["install", serviceBPath], tmpDir);

      const combinedOutput = allOutput(consoleLogSpy) + "\n" + allOutput(consoleErrorSpy);
      // The conflict message should mention both the allow and deny patterns
      expect(combinedOutput).toContain("Bash(rm -rf *)");
      expect(combinedOutput).toContain("Bash(rm *)");
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // E10: Check dry-run has no side effects
  // ──────────────────────────────────────────────────────────────────

  describe("E10: check command (dry-run) has no side effects", () => {
    test("check reports conflicts but does not modify lockfile or settings", async () => {
      // Initialize
      const initCode = await runCli(["init"], tmpDir);
      expect(initCode).toBe(0);

      // Install service-a
      const serviceAPath = await writeManifest(tmpDir, {
        name: "service-a",
        version: "1.0.0",
        hooks: [{ id: "h1", on: "stop", command: "echo a" }],
      });
      const installACode = await runCli(["install", serviceAPath], tmpDir);
      expect(installACode).toBe(0);

      // Snapshot lockfile and settings after installing service-a
      const lockfilePath = path.join(tmpDir, ".uhr", "uhr.lock.json");
      const settingsPath = path.join(tmpDir, ".claude", "settings.json");

      const lockfileSnapshot = await readFile(lockfilePath, "utf8");
      const settingsSnapshot = await readFile(settingsPath, "utf8");

      // Write service-b with explicit conflict
      const serviceBPath = await writeManifest(tmpDir, {
        name: "service-b",
        version: "1.0.0",
        hooks: [{ id: "h1", on: "stop", command: "echo b" }],
        conflicts: ["service-a"],
      });

      // check should report conflict (exit 1) but NOT change any files
      const checkCode = await runCli(["check", serviceBPath], tmpDir);
      expect(checkCode).toBe(1);

      // Lockfile should be unchanged
      const lockfileAfterCheck = await readFile(lockfilePath, "utf8");
      expect(lockfileAfterCheck).toBe(lockfileSnapshot);

      // Settings file should be unchanged
      const settingsAfterCheck = await readFile(settingsPath, "utf8");
      expect(settingsAfterCheck).toBe(settingsSnapshot);

      // Lockfile should still only contain service-a
      const lockfileData = JSON.parse(lockfileAfterCheck);
      expect(lockfileData.installed["service-a"]).toBeDefined();
      expect(lockfileData.installed["service-b"]).toBeUndefined();
    });

    test("check on a clean manifest reports no conflicts", async () => {
      await runCli(["init"], tmpDir);

      // Write a manifest with no conflicts
      const serviceAPath = await writeManifest(tmpDir, {
        name: "service-a",
        version: "1.0.0",
        hooks: [{ id: "h1", on: "stop", command: "echo a" }],
      });

      const checkCode = await runCli(["check", serviceAPath], tmpDir);
      expect(checkCode).toBe(0);

      const combinedOutput = allOutput(consoleLogSpy);
      expect(combinedOutput).toContain("No conflicts");
    });
  });
});
