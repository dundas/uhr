import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { importCodex } from "../../src/importers/codex";

let cwd: string | undefined;

afterEach(async () => {
  if (cwd) await rm(cwd, { recursive: true, force: true });
  cwd = undefined;
});

describe("importCodex", () => {
  test("imports command handlers with matcher, timeout, async, and blocking semantics", async () => {
    cwd = await mkdtemp(path.join(tmpdir(), "uhr-codex-import-"));
    await mkdir(path.join(cwd, ".codex"));
    const fixture = path.join(import.meta.dir, "..", "fixtures", "codex-hooks.json");
    await Bun.write(path.join(cwd, ".codex", "hooks.json"), Bun.file(fixture));

    const result = await importCodex(cwd);
    expect(result.summary.hooksImported).toBe(2);
    expect(result.service?.hooks[0]).toMatchObject({
      on: "beforeToolExecution",
      command: "background-check",
      tools: ["bash", "write"],
      timeout: 12000,
      background: true,
      blocking: false,
      platforms: ["codex"]
    });
    expect(result.service?.hooks[1]).toMatchObject({ on: "stop", command: "finish", blocking: true });
    expect(result.summary.warnings.join("\n")).toContain("mcp_tool");
    expect(result.summary.warnings.join("\n")).toContain("Interrupt");
    expect(result.summary.warnings.join("\n")).toContain("matcher cannot be represented");
  });
});
