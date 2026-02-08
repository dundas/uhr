import { describe, expect, test } from "bun:test";
import { detectConflicts } from "../src/conflicts";
import type { ServiceManifest, UhrLockfile } from "../src/types";

describe("detectConflicts", () => {
  test("detects explicit conflict", () => {
    const manifest: ServiceManifest = {
      name: "teleportation-cli",
      version: "1.2.0",
      hooks: [],
      conflicts: ["gitbutler"]
    };

    const lockfile: UhrLockfile = {
      lockfileVersion: 1,
      generatedAt: new Date().toISOString(),
      generatedBy: "uhr@0.1.0",
      platforms: ["claude-code"],
      installed: {
        gitbutler: {
          version: "0.5.0",
          installedAt: new Date().toISOString(),
          integrity: "sha256-deadbeef",
          source: "local:/tmp/gitbutler.json",
          hooks: []
        }
      },
      resolvedOrder: {}
    };

    const conflicts = detectConflicts(manifest, lockfile);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.type).toBe("explicit");
  });
});
