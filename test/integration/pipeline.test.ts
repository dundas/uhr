import { describe, expect, test, beforeEach, afterEach, spyOn } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runCli } from "../../src/cli";
import {
  formatterManifest,
  linterManifest,
  securityManifest,
  writeManifest,
  readJsonFile,
} from "./helpers";

let tmpDir: string;
let originalCwd: string;
let consoleLogSpy: ReturnType<typeof spyOn>;
let consoleErrorSpy: ReturnType<typeof spyOn>;

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(tmpdir(), "uhr-integ-"));
  originalCwd = process.cwd();
  process.chdir(tmpDir);

  consoleLogSpy = spyOn(console, "log").mockImplementation(() => {});
  consoleErrorSpy = spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
  consoleLogSpy.mockRestore();
  consoleErrorSpy.mockRestore();

  process.chdir(originalCwd);
  await rm(tmpDir, { recursive: true, force: true });
});

// ──────────────────────────────────────────────────────────────────────
// E1: Init -> Install -> List -> Doctor (happy path)
// ──────────────────────────────────────────────────────────────────────

describe("E1: Init -> Install -> List -> Doctor", () => {
  test("full happy-path pipeline succeeds", async () => {
    // 1. Init
    const initExit = await runCli(["init"]);
    expect(initExit).toBe(0);

    // 2. Verify lockfile exists
    const lockfilePath = path.join(tmpDir, ".uhr", "uhr.lock.json");
    const lockfileExists = await Bun.file(lockfilePath).exists();
    expect(lockfileExists).toBe(true);

    // 3. Write formatter manifest and install
    const manifestPath = await writeManifest(tmpDir, formatterManifest());
    const installExit = await runCli(["install", manifestPath]);
    expect(installExit).toBe(0);

    // 4. Read lockfile and verify installed service
    const lockfile = (await readJsonFile(lockfilePath)) as Record<string, unknown>;
    const installed = lockfile.installed as Record<string, unknown>;
    expect(installed["test-formatter"]).toBeDefined();

    const formatterEntry = installed["test-formatter"] as Record<string, unknown>;
    expect(formatterEntry.version).toBe("1.0.0");
    expect(typeof formatterEntry.integrity).toBe("string");
    expect((formatterEntry.integrity as string).startsWith("sha256-")).toBe(true);

    // 5. Read .claude/settings.json and verify generated config
    const settingsPath = path.join(tmpDir, ".claude", "settings.json");
    const settings = (await readJsonFile(settingsPath)) as Record<string, unknown>;
    expect(settings._managedBy).toBe("uhr");

    const hooks = settings.hooks as Record<string, unknown[]>;
    expect(hooks.PostToolUse).toBeDefined();
    expect(hooks.PostToolUse.length).toBeGreaterThan(0);

    const firstHook = hooks.PostToolUse[0] as Record<string, unknown>;
    const matcher = firstHook.matcher as string;
    expect(matcher).toContain("Edit");
    expect(matcher).toContain("Write");

    const permissions = settings.permissions as Record<string, string[]>;
    expect(permissions.allowedTools).toContain("Bash(prettier *)");

    // 6. Verify stored manifest exists
    const storedManifestPath = path.join(tmpDir, ".uhr", "services", "test-formatter.json");
    const storedExists = await Bun.file(storedManifestPath).exists();
    expect(storedExists).toBe(true);

    // 7. List shows installed service
    consoleLogSpy.mockClear();
    const listExit = await runCli(["list"]);
    expect(listExit).toBe(0);
    expect(consoleLogSpy).toHaveBeenCalledWith("test-formatter@1.0.0");

    // 8. Doctor reports no errors
    consoleLogSpy.mockClear();
    const doctorExit = await runCli(["doctor"]);
    expect(doctorExit).toBe(0);
  });
});

// ──────────────────────────────────────────────────────────────────────
// E2: Multi-service install with ordering
// ──────────────────────────────────────────────────────────────────────

describe("E2: Multi-service install with ordering", () => {
  test("ordering constraints produce correct resolvedOrder and config", async () => {
    // 1. Init
    const initExit = await runCli(["init"]);
    expect(initExit).toBe(0);

    // 2. Write and install linter
    const linterPath = await writeManifest(tmpDir, linterManifest());
    const linterInstall = await runCli(["install", linterPath]);
    expect(linterInstall).toBe(0);

    // 3. Write and install security (runAfter: test-linter/lint-check)
    const securityPath = await writeManifest(tmpDir, securityManifest());
    const securityInstall = await runCli(["install", securityPath]);
    expect(securityInstall).toBe(0);

    // 4. Read lockfile and verify resolvedOrder
    const lockfilePath = path.join(tmpDir, ".uhr", "uhr.lock.json");
    const lockfile = (await readJsonFile(lockfilePath)) as Record<string, unknown>;
    const resolvedOrder = lockfile.resolvedOrder as Record<string, string[]>;
    expect(resolvedOrder.beforeToolExecution).toEqual([
      "test-linter/lint-check",
      "test-security/security-scan",
    ]);

    // 5. Read .claude/settings.json and verify hook ordering
    const settingsPath = path.join(tmpDir, ".claude", "settings.json");
    const settings = (await readJsonFile(settingsPath)) as Record<string, unknown>;
    const hooks = settings.hooks as Record<string, unknown[]>;
    expect(hooks.PreToolUse).toBeDefined();
    expect(hooks.PreToolUse.length).toBe(2);

    const firstSource = (hooks.PreToolUse[0] as Record<string, unknown>)._uhrSource;
    const secondSource = (hooks.PreToolUse[1] as Record<string, unknown>)._uhrSource;
    expect(firstSource).toBe("test-linter/lint-check");
    expect(secondSource).toBe("test-security/security-scan");
  });
});

// ──────────────────────────────────────────────────────────────────────
// E8: Update re-reads manifest
// ──────────────────────────────────────────────────────────────────────

describe("E8: Update re-reads manifest", () => {
  test("update picks up new version and additional hook", async () => {
    // 1. Init and install v1.0.0
    await runCli(["init"]);
    const manifestPath = await writeManifest(tmpDir, formatterManifest());
    const installExit = await runCli(["install", manifestPath]);
    expect(installExit).toBe(0);

    // 2. Overwrite manifest with v2.0.0 + additional hook
    const updatedManifest = {
      ...formatterManifest(),
      version: "2.0.0",
      hooks: [
        ...formatterManifest().hooks,
        {
          id: "format-on-save",
          on: "afterToolExecution",
          tools: ["write"],
          command: "prettier --write --check $UHR_FILE",
        },
      ],
    };
    await Bun.write(manifestPath, JSON.stringify(updatedManifest, null, 2));

    // 3. Update
    const updateExit = await runCli(["update", "test-formatter"]);
    expect(updateExit).toBe(0);

    // 4. Verify lockfile has updated version
    const lockfilePath = path.join(tmpDir, ".uhr", "uhr.lock.json");
    const lockfile = (await readJsonFile(lockfilePath)) as Record<string, unknown>;
    const installed = lockfile.installed as Record<string, unknown>;
    const formatterEntry = installed["test-formatter"] as Record<string, unknown>;
    expect(formatterEntry.version).toBe("2.0.0");

    // 5. Verify .claude/settings.json has both hooks
    const settingsPath = path.join(tmpDir, ".claude", "settings.json");
    const settings = (await readJsonFile(settingsPath)) as Record<string, unknown>;
    const hooks = settings.hooks as Record<string, unknown[]>;
    expect(hooks.PostToolUse).toBeDefined();
    expect(hooks.PostToolUse.length).toBe(2);

    const sources = hooks.PostToolUse.map(
      (entry) => (entry as Record<string, unknown>)._uhrSource
    );
    expect(sources).toContain("test-formatter/format-on-write");
    expect(sources).toContain("test-formatter/format-on-save");
  });
});

// ──────────────────────────────────────────────────────────────────────
// E9: Rebuild deterministic regeneration
// ──────────────────────────────────────────────────────────────────────

describe("E9: Rebuild deterministic regeneration", () => {
  test("rebuild reproduces equivalent config after deletion", async () => {
    // 1. Init and install formatter
    await runCli(["init"]);
    const manifestPath = await writeManifest(tmpDir, formatterManifest());
    await runCli(["install", manifestPath]);

    // 2. Read the generated settings
    const settingsPath = path.join(tmpDir, ".claude", "settings.json");
    const originalSettings = (await readJsonFile(settingsPath)) as Record<string, unknown>;

    // 3. Delete .claude/settings.json
    await rm(settingsPath, { force: true });
    const deletedExists = await Bun.file(settingsPath).exists();
    expect(deletedExists).toBe(false);

    // 4. Rebuild
    const rebuildExit = await runCli(["rebuild"]);
    expect(rebuildExit).toBe(0);

    // 5. Read regenerated settings and compare hooks structure
    const rebuiltSettings = (await readJsonFile(settingsPath)) as Record<string, unknown>;
    expect(rebuiltSettings._managedBy).toBe("uhr");

    // Compare hooks structures (ignoring _generatedAt which will differ)
    expect(rebuiltSettings.hooks).toEqual(originalSettings.hooks);
    expect(rebuiltSettings.permissions).toEqual(originalSettings.permissions);
  });
});

// ──────────────────────────────────────────────────────────────────────
// E11: Diff preview
// ──────────────────────────────────────────────────────────────────────

describe("E11: Diff preview", () => {
  test("diff shows service name and hooks to add", async () => {
    // 1. Init
    await runCli(["init"]);

    // 2. Write formatter manifest
    const manifestPath = await writeManifest(tmpDir, formatterManifest());

    // 3. Run diff (not installing, just previewing)
    consoleLogSpy.mockClear();
    const diffExit = await runCli(["diff", manifestPath]);
    expect(diffExit).toBe(0);

    // 4. Verify output includes service name and hooks to add count
    const allCalls = consoleLogSpy.mock.calls.map(
      (args: unknown[]) => (args as string[]).join(" ")
    );
    const fullOutput = allCalls.join("\n");

    expect(fullOutput).toContain("test-formatter");
    expect(fullOutput).toContain("Hooks to add: 1");
  });
});
