import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { importGemini } from "../../src/importers/gemini-cli";

let tmpDir: string | undefined;

afterEach(async () => {
  if (tmpDir) {
    await rm(tmpDir, { recursive: true, force: true });
    tmpDir = undefined;
  }
});

describe("importGemini", () => {
  test("returns found=false when no config exists", async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "uhr-gemini-import-"));

    const { summary, service } = await importGemini(tmpDir);

    expect(summary.found).toBe(false);
    expect(summary.hooksImported).toBe(0);
    expect(service).toBeNull();
  });

  test("imports hooks from .gemini/settings.json", async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "uhr-gemini-import-"));
    const geminiDir = path.join(tmpDir, ".gemini");
    await mkdir(geminiDir, { recursive: true });

    await Bun.write(
      path.join(geminiDir, "settings.json"),
      JSON.stringify({
        hooks: {
          SessionStart: [{ command: "init-session" }],
          SessionEnd: [{ command: "end-session" }],
          BeforeTool: [{ command: "check-tool", matcher: "shell|write_file" }]
        }
      })
    );

    const { summary, service } = await importGemini(tmpDir);

    expect(summary.found).toBe(true);
    expect(summary.hooksImported).toBe(3);
    expect(service).not.toBeNull();

    const startHook = service!.hooks.find((h) => h.on === "sessionStart");
    expect(startHook).toBeDefined();
    expect(startHook!.command).toBe("init-session");

    const endHook = service!.hooks.find((h) => h.on === "sessionEnd");
    expect(endHook).toBeDefined();
    expect(endHook!.command).toBe("end-session");

    const toolHook = service!.hooks.find((h) => h.on === "beforeToolExecution");
    expect(toolHook).toBeDefined();
    expect(toolHook!.tools).toContain("bash");
    expect(toolHook!.tools).toContain("write");
  });

  test("warns on unmapped events", async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "uhr-gemini-import-"));
    const geminiDir = path.join(tmpDir, ".gemini");
    await mkdir(geminiDir, { recursive: true });

    await Bun.write(
      path.join(geminiDir, "settings.json"),
      JSON.stringify({
        hooks: {
          CustomEvent: [{ command: "test" }]
        }
      })
    );

    const { summary } = await importGemini(tmpDir);

    expect(summary.warnings).toHaveLength(1);
    expect(summary.warnings[0]).toContain("CustomEvent");
  });
});
