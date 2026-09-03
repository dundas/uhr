import { afterEach, describe, expect, test } from "bun:test";
import { chmod, lstat, mkdir, mkdtemp, readlink, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { rebuildFromLockfile } from "../src/rebuild";
import { listBackups, restoreBackup } from "../src/backup";
import { createDefaultLockfile, writeLockfile } from "../src/lockfile";
import { runDoctor } from "../src/doctor";
import type { UhrLockfile } from "../src/types";

let cwd: string | undefined;

afterEach(async () => {
  if (cwd) await rm(cwd, { recursive: true, force: true });
  cwd = undefined;
});

function codexLockfile(): UhrLockfile {
  const lockfile = createDefaultLockfile(["codex"]);
  lockfile.mergeMode = "preserve";
  lockfile.installed.service = {
    version: "1.0.0",
    installedAt: lockfile.generatedAt,
    integrity: "sha256-test",
    source: "local:/missing",
    hooks: [{ id: "start", on: "sessionStart", command: "managed-start", platforms: ["codex"] }]
  };
  lockfile.resolvedOrder = { sessionStart: ["service/start"] };
  return lockfile;
}

describe("Codex preserve rebuild", () => {
  test("preserves manual hooks, removes prior managed hooks, and remains idempotent without provider metadata", async () => {
    cwd = await mkdtemp(path.join(tmpdir(), "uhr-codex-rebuild-"));
    const target = path.join(cwd, ".codex", "hooks.json");
    await mkdir(path.dirname(target));
    await Bun.write(target, JSON.stringify({ description: "manual", hooks: {
      SessionStart: [{ hooks: [{ type: "command", command: "manual-start" }] }]
    } }));

    const lockfile = codexLockfile();
    await rebuildFromLockfile(lockfile, cwd);
    await rebuildFromLockfile(lockfile, cwd);

    const config = await Bun.file(target).json();
    expect(config.hooks.SessionStart).toHaveLength(2);
    expect(config.hooks.SessionStart.map((entry: { hooks: Array<{ command: string }> }) => entry.hooks[0].command))
      .toEqual(["manual-start", "managed-start"]);
    expect(JSON.stringify(config)).not.toContain("_uhr");
  });

  test("atomically replaces content while preserving the existing file mode", async () => {
    cwd = await mkdtemp(path.join(tmpdir(), "uhr-codex-mode-"));
    const target = path.join(cwd, ".codex", "hooks.json");
    await mkdir(path.dirname(target));
    await Bun.write(target, JSON.stringify({ hooks: {} }));
    await chmod(target, 0o600);

    await rebuildFromLockfile(codexLockfile(), cwd);

    expect((await lstat(target)).mode & 0o777).toBe(0o600);
    expect((await import("node:fs/promises")).readdir(path.dirname(target)).then((names) => names.filter((name) => name.includes(".tmp-"))))
      .resolves.toEqual([]);
  });

  test("rejects a symlinked config directory before backup or write", async () => {
    cwd = await mkdtemp(path.join(tmpdir(), "uhr-codex-symlink-"));
    const outside = await mkdtemp(path.join(tmpdir(), "uhr-codex-outside-"));
    await symlink(outside, path.join(cwd, ".codex"));

    await expect(rebuildFromLockfile(codexLockfile(), cwd)).rejects.toThrow(/symlink|unsafe/i);
    expect(await Bun.file(path.join(outside, "hooks.json")).exists()).toBe(false);
    expect(await readlink(path.join(cwd, ".codex"))).toBe(outside);
    await rm(outside, { recursive: true, force: true });
  });

  test("does not overwrite malformed manual JSON in preserve mode", async () => {
    cwd = await mkdtemp(path.join(tmpdir(), "uhr-codex-invalid-"));
    const target = path.join(cwd, ".codex", "hooks.json");
    await mkdir(path.dirname(target));
    await Bun.write(target, "{manual-broken");

    await expect(rebuildFromLockfile(codexLockfile(), cwd)).rejects.toThrow(/JSON/);
    expect(await Bun.file(target).text()).toBe("{manual-broken");
  });

  test("restore recovers exact manual config and removes only the generated ownership record", async () => {
    cwd = await mkdtemp(path.join(tmpdir(), "uhr-codex-restore-"));
    const target = path.join(cwd, ".codex", "hooks.json");
    const ownership = path.join(cwd, ".uhr", "generated", "codex.json");
    const original = '{"description":"manual","hooks":{"SessionStart":[]}}\n';
    await mkdir(path.dirname(target));
    await Bun.write(target, original);
    await chmod(target, 0o600);

    await rebuildFromLockfile(codexLockfile(), cwd);
    const [backup] = await listBackups(cwd);
    await restoreBackup(cwd, backup.timestamp);

    expect(await Bun.file(target).text()).toBe(original);
    expect((await lstat(target)).mode & 0o777).toBe(0o600);
    expect(await Bun.file(ownership).exists()).toBe(false);
  });

  test("restore removes a newly generated Codex config only while ownership still matches", async () => {
    cwd = await mkdtemp(path.join(tmpdir(), "uhr-codex-restore-absent-"));
    const target = path.join(cwd, ".codex", "hooks.json");
    const ownership = path.join(cwd, ".uhr", "generated", "codex.json");

    await rebuildFromLockfile(codexLockfile(), cwd);
    const [backup] = await listBackups(cwd);
    await restoreBackup(cwd, backup.timestamp);

    expect(await Bun.file(target).exists()).toBe(false);
    expect(await Bun.file(ownership).exists()).toBe(false);
  });

  test("restore never deletes a manually changed Codex config", async () => {
    cwd = await mkdtemp(path.join(tmpdir(), "uhr-codex-restore-manual-change-"));
    const target = path.join(cwd, ".codex", "hooks.json");
    const manual = '{"description":"changed after rebuild","hooks":{}}\n';

    await rebuildFromLockfile(codexLockfile(), cwd);
    const [backup] = await listBackups(cwd);
    await Bun.write(target, manual);
    await restoreBackup(cwd, backup.timestamp);

    expect(await Bun.file(target).text()).toBe(manual);
  });
});

describe("Codex doctor", () => {
  test("reports project hook trust as unverifiable instead of claiming healthy", async () => {
    cwd = await mkdtemp(path.join(tmpdir(), "uhr-codex-doctor-trust-"));
    const lockfile = codexLockfile();
    await writeLockfile("project", cwd, lockfile);
    await rebuildFromLockfile(lockfile, cwd);

    const issues = await runDoctor(cwd);
    expect(issues.some((issue) => issue.severity === "warning" && /trust.*cannot be verified|cannot verify.*trust/i.test(issue.message))).toBe(true);
    expect(issues.some((issue) => issue.message.includes("/hooks"))).toBe(true);
  });

  test("reports project hooks explicitly disabled in Codex config", async () => {
    cwd = await mkdtemp(path.join(tmpdir(), "uhr-codex-doctor-disabled-"));
    const lockfile = codexLockfile();
    await writeLockfile("project", cwd, lockfile);
    await rebuildFromLockfile(lockfile, cwd);
    await Bun.write(path.join(cwd, ".codex", "config.toml"), "[features]\nhooks = false\n");

    const issues = await runDoctor(cwd);
    expect(issues.some((issue) => issue.severity === "error" && /hooks.*disabled/i.test(issue.message))).toBe(true);
  });

  test("reports generated hook drift", async () => {
    cwd = await mkdtemp(path.join(tmpdir(), "uhr-codex-doctor-"));
    const lockfile = codexLockfile();
    await writeLockfile("project", cwd, lockfile);
    await rebuildFromLockfile(lockfile, cwd);
    const target = path.join(cwd, ".codex", "hooks.json");
    const config = await Bun.file(target).json();
    config.hooks.SessionStart = [];
    await Bun.write(target, JSON.stringify(config));

    const issues = await runDoctor(cwd);
    expect(issues.some((issue) => issue.message.includes("drift") && issue.message.includes("codex"))).toBe(true);
  });

  test("reports a symlinked Codex target as unsafe", async () => {
    cwd = await mkdtemp(path.join(tmpdir(), "uhr-codex-doctor-symlink-"));
    const outside = await mkdtemp(path.join(tmpdir(), "uhr-codex-doctor-outside-"));
    await writeLockfile("project", cwd, codexLockfile());
    await symlink(outside, path.join(cwd, ".codex"));

    const issues = await runDoctor(cwd);
    expect(issues.some((issue) => issue.severity === "error" && /symlink|unsafe/i.test(issue.message))).toBe(true);
    await rm(outside, { recursive: true, force: true });
  });

  test("reports an unsafe Codex target even when Codex is not selected", async () => {
    cwd = await mkdtemp(path.join(tmpdir(), "uhr-codex-doctor-unmanaged-symlink-"));
    const outside = await mkdtemp(path.join(tmpdir(), "uhr-codex-doctor-unmanaged-outside-"));
    await writeLockfile("project", cwd, createDefaultLockfile(["claude-code"]));
    await symlink(outside, path.join(cwd, ".codex"));

    const issues = await runDoctor(cwd);
    expect(issues.some((issue) => issue.severity === "error" && issue.message.includes("codex") && /symlink|unsafe/i.test(issue.message))).toBe(true);
    await rm(outside, { recursive: true, force: true });
  });
});
