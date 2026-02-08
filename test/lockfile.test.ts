import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  createDefaultLockfile,
  lockfilePathForScope,
  readLockfile,
  writeLockfile
} from "../src/lockfile";

let tmpDir: string | undefined;

afterEach(async () => {
  if (tmpDir) {
    await rm(tmpDir, { recursive: true, force: true });
    tmpDir = undefined;
  }
});

describe("createDefaultLockfile", () => {
  test("returns object with default structure", () => {
    const lockfile = createDefaultLockfile();

    expect(lockfile.lockfileVersion).toBe(2);
    expect(lockfile.platforms).toEqual(["claude-code"]);
    expect(lockfile.installed).toEqual({});
    expect(lockfile.resolvedOrder).toEqual({});
    expect(lockfile.mergeMode).toBe("strict");
  });

  test("accepts custom platforms", () => {
    const lockfile = createDefaultLockfile(["claude-code", "cursor"]);

    expect(lockfile.platforms).toEqual(["claude-code", "cursor"]);
  });

  test("deduplicates platforms", () => {
    const lockfile = createDefaultLockfile(["claude-code", "claude-code", "cursor"]);

    expect(lockfile.platforms).toEqual(["claude-code", "cursor"]);
  });
});

describe("writeLockfile / readLockfile", () => {
  test("write then read returns structurally identical object", async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "uhr-lockfile-test-"));

    const original = createDefaultLockfile();
    await writeLockfile("project", tmpDir, original);

    const loaded = await readLockfile("project", tmpDir);

    expect(loaded).toEqual(original);
  });

  test("parent directories are created automatically", async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "uhr-lockfile-test-"));
    const nested = path.join(tmpDir, "deep", "nested", "project");

    const lockfile = createDefaultLockfile();
    const filepath = await writeLockfile("project", nested, lockfile);

    expect(filepath).toBe(lockfilePathForScope("project", nested));

    const loaded = await readLockfile("project", nested);
    expect(loaded.lockfileVersion).toBe(2);
  });
});

describe("readLockfile fallback", () => {
  test("returns default lockfile when no lockfile exists on disk", async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "uhr-lockfile-test-"));

    const lockfile = await readLockfile("project", tmpDir);

    expect(lockfile.lockfileVersion).toBe(2);
    expect(lockfile.platforms).toEqual(["claude-code"]);
    expect(lockfile.installed).toEqual({});
    expect(lockfile.resolvedOrder).toEqual({});
    expect(lockfile.mergeMode).toBe("strict");
  });
});

describe("v1 → v2 upgrade", () => {
  test("reading a v1 lockfile upgrades it to v2 with provenance defaults", async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "uhr-lockfile-test-"));
    const lockfilePath = lockfilePathForScope("project", tmpDir);
    const { mkdir } = await import("node:fs/promises");
    await mkdir(path.dirname(lockfilePath), { recursive: true });

    const v1 = {
      lockfileVersion: 1,
      generatedAt: "2026-01-01T00:00:00.000Z",
      generatedBy: "uhr@0.0.1",
      platforms: ["claude-code"],
      installed: {
        "test-svc": {
          version: "1.0.0",
          installedAt: "2026-01-01T00:00:00.000Z",
          integrity: "sha256-abc",
          source: "local:/tmp/test.json",
          hooks: [{ id: "h1", on: "sessionStart", command: "echo hi" }]
        }
      },
      resolvedOrder: { sessionStart: ["test-svc/h1"] }
    };
    await Bun.write(lockfilePath, JSON.stringify(v1));

    const lockfile = await readLockfile("project", tmpDir);

    expect(lockfile.lockfileVersion).toBe(2);
    expect(lockfile.mergeMode).toBe("strict");
    expect(lockfile.installed["test-svc"].ownership).toBe("uhr-managed");
    expect(lockfile.installed["test-svc"].sourceType).toBe("uhr-service");
    expect(lockfile.installed["test-svc"].sourcePlatform).toBeNull();
  });

  test("write then read v2 preserves provenance fields", async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "uhr-lockfile-test-"));

    const lockfile = createDefaultLockfile();
    lockfile.installed["my-svc"] = {
      version: "2.0.0",
      installedAt: new Date().toISOString(),
      integrity: "sha256-xyz",
      source: "local:/tmp/svc.json",
      hooks: [{ id: "h1", on: "stop", command: "cleanup" }],
      ownership: "imported",
      sourceType: "imported-manual",
      sourcePlatform: "claude-code"
    };

    await writeLockfile("project", tmpDir, lockfile);
    const loaded = await readLockfile("project", tmpDir);

    expect(loaded.installed["my-svc"].ownership).toBe("imported");
    expect(loaded.installed["my-svc"].sourceType).toBe("imported-manual");
    expect(loaded.installed["my-svc"].sourcePlatform).toBe("claude-code");
  });
});
