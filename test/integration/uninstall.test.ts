import { describe, expect, test, beforeEach, afterEach, spyOn } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runCli } from "../../src/cli";
import { writeManifest, readJsonFile } from "./helpers";

let tmpDir: string;
let consoleLogSpy: ReturnType<typeof spyOn>;
let consoleErrorSpy: ReturnType<typeof spyOn>;

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(tmpdir(), "uhr-uninstall-"));

  consoleLogSpy = spyOn(console, "log").mockImplementation(() => {});
  consoleErrorSpy = spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
  consoleLogSpy.mockRestore();
  consoleErrorSpy.mockRestore();

  await rm(tmpDir, { recursive: true, force: true });
});

// ----------------------------------------------------------------------
// E6: Clean uninstall removes service fully
// ----------------------------------------------------------------------

describe("E6: Clean uninstall removes service fully", () => {
  test("uninstalling one service leaves the other intact", async () => {
    // 1. Init
    const initExit = await runCli(["init"], tmpDir);
    expect(initExit).toBe(0);

    // 2. Write service-a manifest (stop event)
    const serviceAManifest = {
      name: "service-a",
      version: "1.0.0",
      hooks: [{ id: "h1", on: "stop", command: "echo a" }],
    };
    const serviceAPath = await writeManifest(tmpDir, serviceAManifest);

    // 3. Write service-b manifest (sessionStart event)
    const serviceBManifest = {
      name: "service-b",
      version: "1.0.0",
      hooks: [{ id: "h1", on: "sessionStart", command: "echo b" }],
    };
    const serviceBPath = await writeManifest(tmpDir, serviceBManifest);

    // 4. Install both
    const installA = await runCli(["install", serviceAPath], tmpDir);
    expect(installA).toBe(0);
    const installB = await runCli(["install", serviceBPath], tmpDir);
    expect(installB).toBe(0);

    // 5. Verify both in lockfile
    const lockfilePath = path.join(tmpDir, ".uhr", "uhr.lock.json");
    const lockfileBefore = (await readJsonFile(lockfilePath)) as Record<string, unknown>;
    const installedBefore = lockfileBefore.installed as Record<string, unknown>;
    expect(installedBefore["service-a"]).toBeDefined();
    expect(installedBefore["service-b"]).toBeDefined();

    // 6. Uninstall service-a
    const uninstallExit = await runCli(["uninstall", "service-a"], tmpDir);
    expect(uninstallExit).toBe(0);

    // 7. Read lockfile: only service-b remains, service-a is gone
    const lockfileAfter = (await readJsonFile(lockfilePath)) as Record<string, unknown>;
    const installedAfter = lockfileAfter.installed as Record<string, unknown>;
    expect(installedAfter["service-a"]).toBeUndefined();
    expect(installedAfter["service-b"]).toBeDefined();

    // 8. Read .claude/settings.json: only service-b hooks (SessionStart), no Stop hooks
    const settingsPath = path.join(tmpDir, ".claude", "settings.json");
    const settings = (await readJsonFile(settingsPath)) as Record<string, unknown>;
    const hooks = settings.hooks as Record<string, unknown[]>;

    // SessionStart should exist with service-b hook
    expect(hooks.SessionStart).toBeDefined();
    expect(hooks.SessionStart.length).toBe(1);
    const sessionStartHook = hooks.SessionStart[0] as Record<string, unknown>;
    expect(sessionStartHook._uhrSource).toBe("service-b/h1");

    // Stop should NOT exist (service-a was removed)
    expect(hooks.Stop).toBeUndefined();

    // 9. Check .uhr/services/service-a.json does NOT exist (deleted)
    const serviceAStoredPath = path.join(tmpDir, ".uhr", "services", "service-a.json");
    const serviceAExists = await Bun.file(serviceAStoredPath).exists();
    expect(serviceAExists).toBe(false);

    // 10. Check .uhr/services/service-b.json DOES exist (kept)
    const serviceBStoredPath = path.join(tmpDir, ".uhr", "services", "service-b.json");
    const serviceBExists = await Bun.file(serviceBStoredPath).exists();
    expect(serviceBExists).toBe(true);
  });
});

// ----------------------------------------------------------------------
// E7: Uninstall blocked by dependent service
// ----------------------------------------------------------------------

describe("E7: Uninstall blocked by dependent service", () => {
  test("cannot uninstall a service required by another", async () => {
    // 1. Init
    const initExit = await runCli(["init"], tmpDir);
    expect(initExit).toBe(0);

    // 2. Write service-a manifest
    const serviceAManifest = {
      name: "service-a",
      version: "1.0.0",
      hooks: [{ id: "h1", on: "stop", command: "echo a" }],
    };
    const serviceAPath = await writeManifest(tmpDir, serviceAManifest);

    // 3. Install service-a
    const installA = await runCli(["install", serviceAPath], tmpDir);
    expect(installA).toBe(0);

    // 4. Write service-b manifest that requires service-a
    const serviceBManifest = {
      name: "service-b",
      version: "1.0.0",
      hooks: [{ id: "h1", on: "stop", command: "echo b" }],
      requires: ["service-a"],
    };
    const serviceBPath = await writeManifest(tmpDir, serviceBManifest);

    // 5. Install service-b (service-a is already installed, so requires check passes)
    const installB = await runCli(["install", serviceBPath], tmpDir);
    expect(installB).toBe(0);

    // 6. Attempt to uninstall service-a -> should fail (exit 1)
    consoleErrorSpy.mockClear();
    const uninstallExit = await runCli(["uninstall", "service-a"], tmpDir);
    expect(uninstallExit).toBe(1);

    // 7. Check console output includes "required by" and "service-b"
    const errorCalls = consoleErrorSpy.mock.calls.map(
      (args: unknown[]) => (args as string[]).join(" ")
    );
    const errorOutput = errorCalls.join("\n");
    expect(errorOutput).toContain("required by");
    expect(errorOutput).toContain("service-b");

    // 8. Verify lockfile still has both services (nothing was removed)
    const lockfilePath = path.join(tmpDir, ".uhr", "uhr.lock.json");
    const lockfile = (await readJsonFile(lockfilePath)) as Record<string, unknown>;
    const installed = lockfile.installed as Record<string, unknown>;
    expect(installed["service-a"]).toBeDefined();
    expect(installed["service-b"]).toBeDefined();
  });
});

// ----------------------------------------------------------------------
// Additional: Uninstall non-existent service
// ----------------------------------------------------------------------

describe("Uninstall non-existent service", () => {
  test("uninstalling a service that is not installed returns exit 1", async () => {
    // 1. Init
    const initExit = await runCli(["init"], tmpDir);
    expect(initExit).toBe(0);

    // 2. Attempt to uninstall a service that was never installed
    consoleErrorSpy.mockClear();
    const uninstallExit = await runCli(["uninstall", "nonexistent"], tmpDir);
    expect(uninstallExit).toBe(1);

    // 3. Check output includes "not installed"
    const errorCalls = consoleErrorSpy.mock.calls.map(
      (args: unknown[]) => (args as string[]).join(" ")
    );
    const errorOutput = errorCalls.join("\n");
    expect(errorOutput).toContain("not installed");
  });
});
