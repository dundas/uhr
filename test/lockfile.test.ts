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

    expect(lockfile.lockfileVersion).toBe(1);
    expect(lockfile.platforms).toEqual(["claude-code"]);
    expect(lockfile.installed).toEqual({});
    expect(lockfile.resolvedOrder).toEqual({});
  });

  test("accepts custom platforms", () => {
    const lockfile = createDefaultLockfile(["claude-code", "cursor"]);

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
    expect(loaded.lockfileVersion).toBe(1);
  });
});

describe("readLockfile fallback", () => {
  test("returns default lockfile when no lockfile exists on disk", async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "uhr-lockfile-test-"));

    const lockfile = await readLockfile("project", tmpDir);

    expect(lockfile.lockfileVersion).toBe(1);
    expect(lockfile.platforms).toEqual(["claude-code"]);
    expect(lockfile.installed).toEqual({});
    expect(lockfile.resolvedOrder).toEqual({});
  });
});
