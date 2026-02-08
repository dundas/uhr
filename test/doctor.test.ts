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
});
