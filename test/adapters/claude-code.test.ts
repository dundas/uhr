import { describe, expect, test } from "bun:test";
import { claudeCodeAdapter } from "../../src/adapters/claude-code";
import { createDefaultLockfile } from "../../src/lockfile";

describe("claudeCodeAdapter", () => {
  test("generates target path", () => {
    const output = claudeCodeAdapter.generate(createDefaultLockfile(), "/tmp/project");
    expect(output.filepath).toBe("/tmp/project/.claude/settings.json");
  });
});
