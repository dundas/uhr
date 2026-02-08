import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { importCursor } from "../../src/importers/cursor";

let tmpDir: string | undefined;

afterEach(async () => {
  if (tmpDir) {
    await rm(tmpDir, { recursive: true, force: true });
    tmpDir = undefined;
  }
});

describe("importCursor", () => {
  test("returns found=false when no config exists", async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "uhr-cursor-import-"));

    const { summary, service } = await importCursor(tmpDir);

    expect(summary.found).toBe(false);
    expect(summary.hooksImported).toBe(0);
    expect(service).toBeNull();
  });

  test("imports hooks from .cursor/hooks.json", async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "uhr-cursor-import-"));
    const cursorDir = path.join(tmpDir, ".cursor");
    await mkdir(cursorDir, { recursive: true });

    await Bun.write(
      path.join(cursorDir, "hooks.json"),
      JSON.stringify({
        hooks: {
          beforeShellExecution: [{ command: "check-shell" }],
          afterFileEdit: [{ command: "format-file" }],
          stop: [{ command: "cleanup" }]
        }
      })
    );

    const { summary, service } = await importCursor(tmpDir);

    expect(summary.found).toBe(true);
    expect(summary.hooksImported).toBe(3);
    expect(service).not.toBeNull();
    expect(service!.hooks).toHaveLength(3);

    const shellHook = service!.hooks.find((h) => h.on === "beforeToolExecution");
    expect(shellHook).toBeDefined();
    expect(shellHook!.command).toBe("check-shell");
    expect(shellHook!.tools).toEqual(["bash"]);

    const editHook = service!.hooks.find((h) => h.on === "afterToolExecution");
    expect(editHook).toBeDefined();
    expect(editHook!.tools).toEqual(["write", "edit", "multi-edit"]);

    const stopHook = service!.hooks.find((h) => h.on === "stop");
    expect(stopHook).toBeDefined();
    expect(stopHook!.tools).toEqual(["*"]);
  });

  test("warns on unmapped events", async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "uhr-cursor-import-"));
    const cursorDir = path.join(tmpDir, ".cursor");
    await mkdir(cursorDir, { recursive: true });

    await Bun.write(
      path.join(cursorDir, "hooks.json"),
      JSON.stringify({
        hooks: {
          unknownEvent: [{ command: "test" }]
        }
      })
    );

    const { summary } = await importCursor(tmpDir);

    expect(summary.warnings).toHaveLength(1);
    expect(summary.warnings[0]).toContain("unknownEvent");
  });
});
