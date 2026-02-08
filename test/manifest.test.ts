import { describe, expect, test } from "bun:test";
import { validateManifest } from "../src/manifest";

describe("validateManifest", () => {
  test("accepts valid manifest", () => {
    const manifest = validateManifest({
      name: "teleportation-cli",
      version: "1.2.0",
      hooks: [
        {
          id: "approve-writes",
          on: "beforeToolExecution",
          command: "teleport intercept --stdin"
        }
      ]
    });

    expect(manifest.name).toBe("teleportation-cli");
    expect(manifest.hooks).toHaveLength(1);
  });

  test("rejects blocking+background hook", () => {
    expect(() =>
      validateManifest({
        name: "bad-service",
        version: "1.0.0",
        hooks: [
          {
            id: "h1",
            on: "stop",
            command: "echo hi",
            blocking: true,
            background: true
          }
        ]
      })
    ).toThrow("cannot be both blocking and background");
  });
});
