import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import path from "node:path";
import { importClaude } from "../../src/importers/claude-code";

// ──────────────────────────────────────────────────────────────────────
// Test: Claude Code importer maps SessionEnd → sessionEnd
// ──────────────────────────────────────────────────────────────────────

describe("importClaude sessionEnd round-trip", () => {
  const tmpDir = path.join(import.meta.dir, ".tmp-claude-import-test");
  const settingsDir = path.join(tmpDir, ".claude");
  const settingsPath = path.join(settingsDir, "settings.json");

  beforeAll(async () => {
    await Bun.$`mkdir -p ${settingsDir}`;
    const settings = {
      hooks: {
        SessionStart: [
          { matcher: "", hooks: [{ type: "command", command: "echo start" }] }
        ],
        SessionEnd: [
          { matcher: "", hooks: [{ type: "command", command: "echo end" }] }
        ],
        PreToolUse: [
          { matcher: "Write", hooks: [{ type: "command", command: "echo pre" }] }
        ]
      },
      permissions: { allowedTools: ["Bash(npm *)"] }
    };
    await Bun.write(settingsPath, JSON.stringify(settings));
  });

  afterAll(async () => {
    await Bun.$`rm -rf ${tmpDir}`;
  });

  test("imports SessionEnd as sessionEnd universal event", async () => {
    const { summary, service } = await importClaude(tmpDir);
    expect(summary.found).toBe(true);
    expect(service).not.toBeNull();

    const sessionEndHooks = service!.hooks.filter((h) => h.on === "sessionEnd");
    expect(sessionEndHooks).toHaveLength(1);
    expect(sessionEndHooks[0].command).toBe("echo end");
  });

  test("imports SessionStart as sessionStart universal event", async () => {
    const { service } = await importClaude(tmpDir);
    const sessionStartHooks = service!.hooks.filter((h) => h.on === "sessionStart");
    expect(sessionStartHooks).toHaveLength(1);
    expect(sessionStartHooks[0].command).toBe("echo start");
  });

  test("imports all three hooks", async () => {
    const { summary } = await importClaude(tmpDir);
    expect(summary.hooksImported).toBe(3);
  });

  test("no warnings for fully mapped events", async () => {
    const { summary } = await importClaude(tmpDir);
    expect(summary.warnings).toHaveLength(0);
  });
});
