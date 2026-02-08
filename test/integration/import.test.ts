import { afterEach, describe, expect, test, spyOn } from "bun:test";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runCli } from "../../src/cli";

let tmpDir: string | undefined;

afterEach(async () => {
  if (tmpDir) {
    await rm(tmpDir, { recursive: true, force: true });
    tmpDir = undefined;
  }
});

describe("uhr import", () => {
  test("reports no hooks when no platform configs exist", async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "uhr-import-test-"));

    const logSpy = spyOn(console, "log");
    const exitCode = await runCli(["import"], tmpDir);
    const calls = logSpy.mock.calls.map((c) => String(c[0]));
    logSpy.mockRestore();

    expect(exitCode).toBe(0);
    const output = calls.join("\n");
    expect(output).toContain("no config found");
    expect(output).toContain("No hooks found to import.");
  });

  test("discovers hooks from Claude config", async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "uhr-import-test-"));
    const claudeDir = path.join(tmpDir, ".claude");
    await mkdir(claudeDir, { recursive: true });

    await Bun.write(
      path.join(claudeDir, "settings.json"),
      JSON.stringify({
        hooks: {
          PreToolUse: [
            { matcher: "Write", hooks: [{ type: "command", command: "check-write" }] }
          ],
          SessionStart: [
            { matcher: "", hooks: [{ type: "command", command: "init" }] }
          ]
        },
        permissions: { allowedTools: ["Bash(npm *)"] }
      })
    );

    const logSpy = spyOn(console, "log");
    const exitCode = await runCli(["import", "--platforms", "claude-code"], tmpDir);
    const calls = logSpy.mock.calls.map((c) => String(c[0]));
    logSpy.mockRestore();

    expect(exitCode).toBe(0);
    const output = calls.join("\n");
    expect(output).toContain("claude-code: found 2 hook(s)");
    expect(output).toContain("imported-claude-code");
  });

  test("--json outputs structured result", async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "uhr-import-test-"));
    const claudeDir = path.join(tmpDir, ".claude");
    await mkdir(claudeDir, { recursive: true });

    await Bun.write(
      path.join(claudeDir, "settings.json"),
      JSON.stringify({
        hooks: {
          Stop: [{ matcher: "", hooks: [{ type: "command", command: "cleanup" }] }]
        }
      })
    );

    const logSpy = spyOn(console, "log");
    const exitCode = await runCli(["import", "--json", "--platforms", "claude-code"], tmpDir);
    const calls = logSpy.mock.calls.map((c) => String(c[0]));
    logSpy.mockRestore();

    expect(exitCode).toBe(0);
    const parsed = JSON.parse(calls.join(""));
    expect(parsed.summaries).toBeArray();
    expect(parsed.summaries[0].platform).toBe("claude-code");
    expect(parsed.services).toBeArray();
    expect(parsed.services[0].hooks).toHaveLength(1);
  });

  test("discovers hooks across multiple platforms", async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "uhr-import-test-"));

    // Claude
    const claudeDir = path.join(tmpDir, ".claude");
    await mkdir(claudeDir, { recursive: true });
    await Bun.write(
      path.join(claudeDir, "settings.json"),
      JSON.stringify({ hooks: { Stop: [{ matcher: "", hooks: [{ type: "command", command: "claude-stop" }] }] } })
    );

    // Gemini
    const geminiDir = path.join(tmpDir, ".gemini");
    await mkdir(geminiDir, { recursive: true });
    await Bun.write(
      path.join(geminiDir, "settings.json"),
      JSON.stringify({ hooks: { SessionStart: [{ command: "gemini-start" }] } })
    );

    const logSpy = spyOn(console, "log");
    const exitCode = await runCli(["import", "--platforms", "claude-code,gemini-cli"], tmpDir);
    const calls = logSpy.mock.calls.map((c) => String(c[0]));
    logSpy.mockRestore();

    expect(exitCode).toBe(0);
    const output = calls.join("\n");
    expect(output).toContain("claude-code: found 1 hook(s)");
    expect(output).toContain("gemini-cli: found 1 hook(s)");
    expect(output).toContain("2 service(s)");
  });
});
