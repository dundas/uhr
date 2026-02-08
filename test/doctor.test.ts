import { describe, expect, test } from "bun:test";
import path from "node:path";
import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { runDoctor } from "../src/doctor";
import { createDefaultLockfile, writeLockfile } from "../src/lockfile";

describe("runDoctor", () => {
  test("reports missing generated config", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "uhr-doctor-"));
    const lockfile = createDefaultLockfile(["claude-code"]);
    await writeLockfile("project", cwd, lockfile);

    const issues = await runDoctor(cwd);
    expect(issues.some((issue) => issue.message.includes("Generated config missing"))).toBe(true);
  });

  test("reports stale generated timestamp", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "uhr-doctor-"));
    const lockfile = createDefaultLockfile(["claude-code"]);
    lockfile.generatedAt = "2026-02-07T00:00:00.000Z";
    await writeLockfile("project", cwd, lockfile);

    await mkdir(path.join(cwd, ".claude"), { recursive: true });
    await Bun.write(
      path.join(cwd, ".claude", "settings.json"),
      JSON.stringify({ _managedBy: "uhr", _generatedAt: "2026-02-06T00:00:00.000Z", hooks: {} })
    );

    const issues = await runDoctor(cwd);
    expect(issues.some((issue) => issue.message.includes("may be stale"))).toBe(true);
  });

  test("reports unmanaged platform config outside lockfile platforms", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "uhr-doctor-"));
    const lockfile = createDefaultLockfile(["claude-code"]);
    await writeLockfile("project", cwd, lockfile);

    await mkdir(path.join(cwd, ".cursor"), { recursive: true });
    await Bun.write(path.join(cwd, ".cursor", "hooks.json"), JSON.stringify({ version: 1, hooks: {} }));

    const issues = await runDoctor(cwd);
    expect(issues.some((issue) => issue.message.includes("unmanaged by UHR"))).toBe(true);
  });

  test("warns when imported services exist under strict merge mode", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "uhr-doctor-"));
    const lockfile = createDefaultLockfile(["claude-code"]);
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
    await writeLockfile("project", cwd, lockfile);

    // Create the platform config so other checks don't fire
    await mkdir(path.join(cwd, ".claude"), { recursive: true });
    await Bun.write(
      path.join(cwd, ".claude", "settings.json"),
      JSON.stringify({ _managedBy: "uhr", _generatedAt: lockfile.generatedAt, hooks: {} })
    );

    const issues = await runDoctor(cwd);
    const strictWarning = issues.find((i) => i.message.includes("strict") && i.message.includes("imported"));
    expect(strictWarning).toBeDefined();
    expect(strictWarning!.severity).toBe("warning");
    expect(strictWarning!.message).toContain("preserve");
  });

  test("no strict-mode warning when merge mode is preserve", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "uhr-doctor-"));
    const lockfile = createDefaultLockfile(["claude-code"]);
    lockfile.mergeMode = "preserve";
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
    await writeLockfile("project", cwd, lockfile);

    await mkdir(path.join(cwd, ".claude"), { recursive: true });
    await Bun.write(
      path.join(cwd, ".claude", "settings.json"),
      JSON.stringify({ _managedBy: "uhr", _generatedAt: lockfile.generatedAt, hooks: {} })
    );

    const issues = await runDoctor(cwd);
    expect(issues.some((i) => i.message.includes("strict") && i.message.includes("imported"))).toBe(false);
  });

  test("warns when backup index references missing directory", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "uhr-doctor-"));
    const lockfile = createDefaultLockfile(["claude-code"]);
    await writeLockfile("project", cwd, lockfile);

    // Create backup index with a ghost entry
    await mkdir(path.join(cwd, ".uhr", "backups"), { recursive: true });
    await Bun.write(
      path.join(cwd, ".uhr", "backups", "index.json"),
      JSON.stringify({
        version: 1,
        entries: [{
          timestamp: "2026-01-01T00-00-00.000Z",
          files: [".claude/settings.json"],
          createdAt: "2026-01-01T00:00:00.000Z",
          trigger: "install"
        }]
      })
    );

    // Create platform config so other checks don't fire
    await mkdir(path.join(cwd, ".claude"), { recursive: true });
    await Bun.write(
      path.join(cwd, ".claude", "settings.json"),
      JSON.stringify({ _managedBy: "uhr", _generatedAt: lockfile.generatedAt, hooks: {} })
    );

    const issues = await runDoctor(cwd);
    expect(issues.some((i) => i.message.includes("missing directory"))).toBe(true);
  });

  test("reports imported service with missing platform config", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "uhr-doctor-"));
    const lockfile = createDefaultLockfile(["claude-code"]);
    lockfile.installed["imported-cursor"] = {
      version: "0.0.0",
      installedAt: new Date().toISOString(),
      integrity: "sha256-test",
      source: "imported:cursor",
      hooks: [{ id: "h1", on: "sessionStart", command: "init" }],
      ownership: "imported",
      sourceType: "imported-tool",
      sourcePlatform: "cursor"
    };
    await writeLockfile("project", cwd, lockfile);

    // Create claude config (the lockfile platform) but NOT cursor config
    await mkdir(path.join(cwd, ".claude"), { recursive: true });
    await Bun.write(
      path.join(cwd, ".claude", "settings.json"),
      JSON.stringify({ _managedBy: "uhr", _generatedAt: lockfile.generatedAt, hooks: {} })
    );

    const issues = await runDoctor(cwd);
    expect(issues.some((i) => i.message.includes("imported-cursor") && i.message.includes("platform config is missing"))).toBe(true);
  });
});
