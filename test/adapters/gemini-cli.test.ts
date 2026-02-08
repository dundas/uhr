import { describe, expect, test } from "bun:test";
import { geminiCliAdapter } from "../../src/adapters/gemini-cli";
import { createDefaultLockfile } from "../../src/lockfile";

describe("geminiCliAdapter", () => {
  test("maps beforeToolExecution to BeforeTool", () => {
    const lockfile = createDefaultLockfile(["gemini-cli"]);
    lockfile.installed.service = {
      version: "1.0.0",
      installedAt: new Date().toISOString(),
      integrity: "sha256-a",
      source: "local:/tmp/svc.json",
      hooks: [{ id: "h1", on: "beforeToolExecution", tools: ["write"], command: "echo hi" }]
    };
    lockfile.resolvedOrder.beforeToolExecution = ["service/h1"];

    const output = geminiCliAdapter.generate(lockfile, "/tmp/project");
    const config = output.content as {
      _generatedAt: string;
      hooks: Record<string, Array<{ matcher: string; command: string }>>;
    };

    expect(config.hooks.BeforeTool).toBeDefined();
    expect(config.hooks.BeforeTool[0]?.matcher).toBe("write_file");
    expect(config._generatedAt).toBe(lockfile.generatedAt);
    expect(output.warnings).toHaveLength(0);
  });

  test("warns for unsupported events", () => {
    const lockfile = createDefaultLockfile(["gemini-cli"]);
    lockfile.installed.service = {
      version: "1.0.0",
      installedAt: new Date().toISOString(),
      integrity: "sha256-a",
      source: "local:/tmp/svc.json",
      hooks: [{ id: "h1", on: "beforeFileRead", command: "echo read" }]
    };
    lockfile.resolvedOrder.beforeFileRead = ["service/h1"];

    const output = geminiCliAdapter.generate(lockfile, "/tmp/project");
    expect(output.warnings.length).toBeGreaterThan(0);
  });
});
