import { describe, expect, test } from "bun:test";
import { uninstallBlockers } from "../src/service-state";

describe("uninstallBlockers", () => {
  test("returns services that require target service", () => {
    const blockers = uninstallBlockers("core-sync", {
      lockfileVersion: 1,
      generatedAt: new Date().toISOString(),
      generatedBy: "uhr@0.1.0",
      platforms: ["claude-code"],
      installed: {
        "core-sync": {
          version: "1.0.0",
          installedAt: new Date().toISOString(),
          integrity: "sha256-a",
          source: "local:/tmp/a",
          hooks: []
        },
        formatter: {
          version: "1.0.0",
          installedAt: new Date().toISOString(),
          integrity: "sha256-b",
          source: "local:/tmp/b",
          hooks: [],
          requires: ["core-sync"]
        },
        scanner: {
          version: "1.0.0",
          installedAt: new Date().toISOString(),
          integrity: "sha256-c",
          source: "local:/tmp/c",
          hooks: []
        }
      },
      resolvedOrder: {}
    });

    expect(blockers).toEqual(["formatter"]);
  });
});
