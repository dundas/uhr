import { describe, expect, test, beforeEach, afterEach, spyOn } from "bun:test";
import path from "node:path";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { runDoctor } from "../../src/doctor";
import { runCli } from "../../src/cli";
import { createDefaultLockfile, writeLockfile, readLockfile } from "../../src/lockfile";
import { computeIntegrity } from "../../src/util/integrity";

// ──────────────────────────────────────────────────────────────────────
// Test E12: Doctor issue detection
// ──────────────────────────────────────────────────────────────────────

describe("doctor integration", () => {
  let tmpDir: string;
  let consoleLogSpy: ReturnType<typeof spyOn>;
  let consoleErrorSpy: ReturnType<typeof spyOn>;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "uhr-doctor-int-"));
    consoleLogSpy = spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(async () => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("missing lockfile is reported as an issue", async () => {
    // Fresh tmpDir with no .uhr/ directory
    const issues = await runDoctor(tmpDir);

    expect(issues.length).toBeGreaterThan(0);
    const hasLockfileIssue = issues.some(
      (issue) => issue.message.toLowerCase().includes("lockfile") && issue.message.toLowerCase().includes("missing")
    );
    expect(hasLockfileIssue).toBe(true);
  });

  test("stale config is detected when lockfile timestamp differs from config", async () => {
    // Step 1: Init and install a service so lockfile + config exist
    const manifest = {
      name: "stale-svc",
      version: "1.0.0",
      hooks: [{ id: "h1", on: "stop", command: "echo stale" }],
    };
    const manifestPath = path.join(tmpDir, "stale-svc.json");
    const manifestContent = JSON.stringify(manifest, null, 2);
    await writeFile(manifestPath, manifestContent, "utf8");

    // Init and install via CLI
    await runCli(["init"], tmpDir);
    await runCli(["install", manifestPath], tmpDir);

    // Step 2: Modify lockfile generatedAt to a future date
    const lockfile = await readLockfile("project", tmpDir);
    lockfile.generatedAt = "2099-12-31T23:59:59.999Z";
    await writeLockfile("project", tmpDir, lockfile);

    // Step 3: Run doctor
    const issues = await runDoctor(tmpDir);

    // Step 4: Verify stale config warning
    const hasStaleIssue = issues.some(
      (issue) => issue.message.includes("stale") || issue.message.includes("outdated") || issue.message.includes("lockfile=")
    );
    expect(hasStaleIssue).toBe(true);
  });

  test("invalid JSON in platform config is detected", async () => {
    // Step 1: Init project so lockfile exists
    const lockfile = createDefaultLockfile(["claude-code"]);
    await writeLockfile("project", tmpDir, lockfile);

    // Step 2: Create .claude/ dir and write broken JSON
    const claudeDir = path.join(tmpDir, ".claude");
    await mkdir(claudeDir, { recursive: true });
    await writeFile(path.join(claudeDir, "settings.json"), "{broken", "utf8");

    // Step 3: Run doctor
    const issues = await runDoctor(tmpDir);

    // Step 4: Verify invalid JSON issue
    const hasInvalidJsonIssue = issues.some(
      (issue) => issue.message.includes("not valid JSON") || issue.message.includes("invalid")
    );
    expect(hasInvalidJsonIssue).toBe(true);
  });

  test("integrity mismatch is detected when source manifest changes", async () => {
    // Step 1: Init and install a service
    const manifest = {
      name: "integrity-svc",
      version: "1.0.0",
      hooks: [{ id: "h1", on: "stop", command: "echo integrity" }],
    };
    const manifestPath = path.join(tmpDir, "integrity-svc.json");
    const manifestContent = JSON.stringify(manifest, null, 2);
    await writeFile(manifestPath, manifestContent, "utf8");

    await runCli(["init"], tmpDir);
    await runCli(["install", manifestPath], tmpDir);

    // Step 2: Modify the original source manifest file (changing content)
    const modifiedManifest = {
      name: "integrity-svc",
      version: "2.0.0",
      hooks: [{ id: "h1", on: "stop", command: "echo modified" }],
    };
    await writeFile(manifestPath, JSON.stringify(modifiedManifest, null, 2), "utf8");

    // Step 3: Run doctor
    const issues = await runDoctor(tmpDir);

    // Step 4: Verify integrity mismatch issue
    const hasIntegrityIssue = issues.some(
      (issue) => issue.message.includes("integrity mismatch") || issue.message.includes("integrity")
    );
    expect(hasIntegrityIssue).toBe(true);
  });

  test("doctor --json outputs valid JSON with issues array", async () => {
    // Step 1: Init in fresh dir (will have warnings about missing config)
    await runCli(["init"], tmpDir);

    // Step 2: Reset the spy to capture only doctor output
    consoleLogSpy.mockRestore();
    const capturedOutput: string[] = [];
    consoleLogSpy = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      capturedOutput.push(args.map(String).join(" "));
    });

    // Step 3: Run doctor --json via CLI
    const exitCode = await runCli(["doctor", "--json"], tmpDir);

    // Step 4: Parse captured output as JSON
    const jsonOutput = capturedOutput.join("\n");
    let parsed: { issues: Array<{ severity: string; message: string }> };
    expect(() => {
      parsed = JSON.parse(jsonOutput);
    }).not.toThrow();

    parsed = JSON.parse(jsonOutput);

    // Step 5: Verify structure
    expect(parsed).toHaveProperty("issues");
    expect(Array.isArray(parsed.issues)).toBe(true);

    // The default lockfile targets claude-code, but no config exists yet,
    // so there should be at least one issue about missing config.
    expect(parsed.issues.length).toBeGreaterThan(0);
    const hasConfigIssue = parsed.issues.some(
      (issue) => issue.message.includes("config") || issue.message.includes("missing")
    );
    expect(hasConfigIssue).toBe(true);
  });

  test("doctor --json includes migration diagnostics for strict mode + imported hooks", async () => {
    await runCli(["init", "--platforms", "claude-code"], tmpDir);

    // Set up imported service under strict merge mode
    const lockfile = await readLockfile("project", tmpDir);
    lockfile.mergeMode = "strict";
    lockfile.installed["imported-claude-code"] = {
      version: "0.0.0",
      installedAt: new Date().toISOString(),
      integrity: "sha256-test",
      source: "imported:claude-code",
      hooks: [{ id: "h1", on: "sessionStart", command: "init" }],
      ownership: "imported",
      sourceType: "imported-tool",
      sourcePlatform: "claude-code"
    };
    await writeLockfile("project", tmpDir, lockfile);

    // Create platform config so missing-config check doesn't fire
    const claudeDir = path.join(tmpDir, ".claude");
    await mkdir(claudeDir, { recursive: true });
    await Bun.write(
      path.join(claudeDir, "settings.json"),
      JSON.stringify({ _managedBy: "uhr", _generatedAt: lockfile.generatedAt, hooks: {} })
    );

    consoleLogSpy.mockRestore();
    const capturedOutput: string[] = [];
    consoleLogSpy = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      capturedOutput.push(args.map(String).join(" "));
    });

    const exitCode = await runCli(["doctor", "--json"], tmpDir);
    const parsed = JSON.parse(capturedOutput.join("\n"));

    expect(exitCode).toBe(0);
    expect(parsed.issues.some((i: { message: string }) =>
      i.message.includes("strict") && i.message.includes("imported")
    )).toBe(true);
  });
});
