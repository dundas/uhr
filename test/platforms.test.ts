import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { builtInAdapters } from "../src/adapters";
import { configPathForPlatform } from "../src/platforms";
import { detectPlatforms } from "../src/util/detect";
import { runCli } from "../src/cli";

describe("Codex platform registration", () => {
  test("is registered with the adapter and canonical project config path", () => {
    expect(builtInAdapters().map((adapter) => adapter.id)).toContain("codex");
    expect(configPathForPlatform("/workspace", "codex")).toBe("/workspace/.codex/hooks.json");
  });

  test("detects a project-local .codex directory", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "uhr-detect-"));
    await mkdir(path.join(cwd, ".codex"));
    expect(detectPlatforms(cwd)).toContain("codex");
    await rm(cwd, { recursive: true, force: true });
  });

  test("CLI accepts codex as an explicit platform", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "uhr-cli-codex-"));
    expect(await runCli(["init", "--platforms", "codex"], cwd)).toBe(0);
    expect((await Bun.file(path.join(cwd, ".uhr", "uhr.lock.json")).json()).platforms).toEqual(["codex"]);
    await rm(cwd, { recursive: true, force: true });
  });
});
