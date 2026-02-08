import { afterEach, describe, expect, test, spyOn } from "bun:test";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runCli } from "../../src/cli";
import { readLockfile } from "../../src/lockfile";

let tmpDir: string | undefined;

afterEach(async () => {
  if (tmpDir) {
    await rm(tmpDir, { recursive: true, force: true });
    tmpDir = undefined;
  }
});

describe("uhr migrate", () => {
  test("dry-run shows migration plan without making changes", async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "uhr-migrate-test-"));
    const claudeDir = path.join(tmpDir, ".claude");
    await mkdir(claudeDir, { recursive: true });
    await Bun.write(
      path.join(claudeDir, "settings.json"),
      JSON.stringify({
        hooks: {
          PreToolUse: [{ matcher: "Write", hooks: [{ type: "command", command: "check" }] }]
        }
      })
    );

    const logSpy = spyOn(console, "log");
    const exitCode = await runCli(
      ["migrate", "--mode", "preserve", "--dry-run", "--platforms", "claude-code"],
      tmpDir
    );
    const calls = logSpy.mock.calls.map((c) => String(c[0]));
    logSpy.mockRestore();

    expect(exitCode).toBe(0);
    const output = calls.join("\n");
    expect(output).toContain("Migration plan:");
    expect(output).toContain("claude-code: 1 hook(s) to import");
    expect(output).toContain("[dry-run] No changes made.");

    // No lockfile should have been created
    const lockfilePath = path.join(tmpDir, ".uhr", "uhr.lock.json");
    expect(await Bun.file(lockfilePath).exists()).toBe(false);
  });

  test("without --yes shows plan and asks for confirmation", async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "uhr-migrate-test-"));
    const claudeDir = path.join(tmpDir, ".claude");
    await mkdir(claudeDir, { recursive: true });
    await Bun.write(
      path.join(claudeDir, "settings.json"),
      JSON.stringify({
        hooks: {
          Stop: [{ matcher: "", hooks: [{ type: "command", command: "cleanup" }] }]
        }
      })
    );

    const logSpy = spyOn(console, "log");
    const exitCode = await runCli(
      ["migrate", "--mode", "preserve", "--platforms", "claude-code"],
      tmpDir
    );
    const calls = logSpy.mock.calls.map((c) => String(c[0]));
    logSpy.mockRestore();

    expect(exitCode).toBe(0);
    const output = calls.join("\n");
    expect(output).toContain("Re-run with --yes to apply");
  });

  test("--yes applies migration: registers imported services and rebuilds", async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "uhr-migrate-test-"));
    const claudeDir = path.join(tmpDir, ".claude");
    await mkdir(claudeDir, { recursive: true });
    await Bun.write(
      path.join(claudeDir, "settings.json"),
      JSON.stringify({
        hooks: {
          SessionStart: [{ matcher: "", hooks: [{ type: "command", command: "init-session" }] }],
          PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "check-bash" }] }]
        },
        permissions: { allowedTools: ["Read(*)"] }
      })
    );

    // Initialize project first
    await runCli(["init", "--platforms", "claude-code"], tmpDir);

    const logSpy = spyOn(console, "log");
    const exitCode = await runCli(
      ["migrate", "--mode", "preserve", "--yes", "--platforms", "claude-code"],
      tmpDir
    );
    const calls = logSpy.mock.calls.map((c) => String(c[0]));
    logSpy.mockRestore();

    expect(exitCode).toBe(0);
    const output = calls.join("\n");
    expect(output).toContain("Migration complete.");

    // Verify lockfile has imported service
    const lockfile = await readLockfile("project", tmpDir);
    expect(lockfile.installed["imported-claude-code"]).toBeDefined();
    expect(lockfile.installed["imported-claude-code"].ownership).toBe("imported");
    expect(lockfile.installed["imported-claude-code"].sourceType).toBe("imported-tool");
    expect(lockfile.mergeMode).toBe("preserve");

    // Verify generated config still contains the hooks
    const settings = await Bun.file(path.join(claudeDir, "settings.json")).json();
    expect(settings.hooks.SessionStart).toBeDefined();
    expect(settings.hooks.PreToolUse).toBeDefined();
  });

  test("no hooks to migrate shows friendly message", async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "uhr-migrate-test-"));

    const logSpy = spyOn(console, "log");
    const exitCode = await runCli(["migrate", "--yes"], tmpDir);
    const calls = logSpy.mock.calls.map((c) => String(c[0]));
    logSpy.mockRestore();

    expect(exitCode).toBe(0);
    const output = calls.join("\n");
    expect(output).toContain("No existing hooks found to migrate.");
  });

  test("invalid mode returns error", async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "uhr-migrate-test-"));

    const errSpy = spyOn(console, "error");
    const exitCode = await runCli(["migrate", "--mode", "invalid"], tmpDir);
    const calls = errSpy.mock.calls.map((c) => String(c[0]));
    errSpy.mockRestore();

    expect(exitCode).toBe(1);
    expect(calls.join("\n")).toContain("Invalid mode");
  });

  test("migrate creates backup before rebuild", async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "uhr-migrate-test-"));
    const claudeDir = path.join(tmpDir, ".claude");
    await mkdir(claudeDir, { recursive: true });
    await Bun.write(
      path.join(claudeDir, "settings.json"),
      JSON.stringify({
        hooks: { Stop: [{ matcher: "", hooks: [{ type: "command", command: "test" }] }] }
      })
    );

    await runCli(["init", "--platforms", "claude-code"], tmpDir);
    await runCli(["migrate", "--mode", "preserve", "--yes", "--platforms", "claude-code"], tmpDir);

    // Verify backup was created
    const indexPath = path.join(tmpDir, ".uhr", "backups", "index.json");
    expect(await Bun.file(indexPath).exists()).toBe(true);
    const index = await Bun.file(indexPath).json();
    const migrateBackup = index.entries.find((e: { trigger: string }) => e.trigger === "migrate");
    expect(migrateBackup).toBeDefined();
  });
});
