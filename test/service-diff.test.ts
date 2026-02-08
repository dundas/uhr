import { describe, expect, test } from "bun:test";
import { diffManifest } from "../src/service-diff";

describe("diffManifest", () => {
  test("reports added/removed/changed hooks", () => {
    const diff = diffManifest(
      {
        name: "svc",
        version: "1.0.0",
        hooks: [
          { id: "a", on: "stop", command: "echo a" },
          { id: "b", on: "stop", command: "echo b" }
        ],
        permissions: { allow: ["Bash(a *)"], deny: [] }
      },
      {
        name: "svc",
        version: "1.1.0",
        hooks: [
          { id: "a", on: "stop", command: "echo changed" },
          { id: "c", on: "stop", command: "echo c" }
        ],
        permissions: { allow: ["Bash(c *)"], deny: [] }
      }
    );

    expect(diff.previousVersion).toBe("1.0.0");
    expect(diff.nextVersion).toBe("1.1.0");
    expect(diff.addedHooks.length).toBe(1);
    expect(diff.removedHooks.length).toBe(1);
    expect(diff.changedHooks.length).toBe(1);
    expect(diff.changedPermissions).toBe(true);
  });
});
