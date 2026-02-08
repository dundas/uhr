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
      lockfileVersion: 2,
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
      resolvedOrder: {},
      mergeMode: "strict"
    };

    const conflicts = detectConflicts(manifest, lockfile);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.type).toBe("explicit");
  });

  test("detects missing requirement", () => {
    const manifest: ServiceManifest = {
      name: "svc-a",
      version: "1.0.0",
      hooks: [],
      requires: ["svc-b"]
    };

    const lockfile: UhrLockfile = {
      lockfileVersion: 2,
      generatedAt: new Date().toISOString(),
      generatedBy: "uhr@0.1.0",
      platforms: ["claude-code"],
      installed: {},
      resolvedOrder: {},
      mergeMode: "strict"
    };

    const conflicts = detectConflicts(manifest, lockfile);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.type).toBe("missing_requirement");
    expect(conflicts[0]?.severity).toBe("error");
    expect(conflicts[0]?.message).toContain("requires svc-b");
  });

  test("detects permission contradiction (allow vs deny)", () => {
    const manifest: ServiceManifest = {
      name: "svc-a",
      version: "1.0.0",
      hooks: [],
      permissions: { allow: ["Bash(npm *)"] }
    };

    const lockfile: UhrLockfile = {
      lockfileVersion: 2,
      generatedAt: new Date().toISOString(),
      generatedBy: "uhr@0.1.0",
      platforms: ["claude-code"],
      installed: {
        "svc-b": {
          version: "1.0.0",
          installedAt: new Date().toISOString(),
          integrity: "sha256-abc",
          source: "local:/tmp/svc-b.json",
          hooks: [],
          permissions: { deny: ["Bash(npm install *)"] }
        }
      },
      resolvedOrder: {},
      mergeMode: "strict"
    };

    const conflicts = detectConflicts(manifest, lockfile);
    expect(conflicts.some((c) => c.type === "permission_contradiction")).toBe(true);
    expect(conflicts.find((c) => c.type === "permission_contradiction")?.severity).toBe("error");
  });

  test("detects duplicate hook", () => {
    const manifest: ServiceManifest = {
      name: "svc-a",
      version: "1.0.0",
      hooks: [
        { id: "lint", on: "beforeToolExecution", command: "run-lint", tools: ["Write"] }
      ]
    };

    const lockfile: UhrLockfile = {
      lockfileVersion: 2,
      generatedAt: new Date().toISOString(),
      generatedBy: "uhr@0.1.0",
      platforms: ["claude-code"],
      installed: {
        "svc-b": {
          version: "1.0.0",
          installedAt: new Date().toISOString(),
          integrity: "sha256-abc",
          source: "local:/tmp/svc-b.json",
          hooks: [
            { id: "lint-check", on: "beforeToolExecution", command: "run-lint", tools: ["Write"] }
          ]
        }
      },
      resolvedOrder: {},
      mergeMode: "strict"
    };

    const conflicts = detectConflicts(manifest, lockfile);
    expect(conflicts.some((c) => c.type === "duplicate_hook")).toBe(true);
    expect(conflicts.find((c) => c.type === "duplicate_hook")?.severity).toBe("warning");
  });

  test("detects shared slot (same event+tools, different command)", () => {
    const manifest: ServiceManifest = {
      name: "svc-a",
      version: "1.0.0",
      hooks: [
        { id: "format", on: "beforeToolExecution", command: "prettier", tools: ["Write"] }
      ]
    };

    const lockfile: UhrLockfile = {
      lockfileVersion: 2,
      generatedAt: new Date().toISOString(),
      generatedBy: "uhr@0.1.0",
      platforms: ["claude-code"],
      installed: {
        "svc-b": {
          version: "1.0.0",
          installedAt: new Date().toISOString(),
          integrity: "sha256-abc",
          source: "local:/tmp/svc-b.json",
          hooks: [
            { id: "lint", on: "beforeToolExecution", command: "eslint", tools: ["Write"] }
          ]
        }
      },
      resolvedOrder: {},
      mergeMode: "strict"
    };

    const conflicts = detectConflicts(manifest, lockfile);
    expect(conflicts.some((c) => c.type === "shared_slot")).toBe(true);
    expect(conflicts.find((c) => c.type === "shared_slot")?.severity).toBe("info");
  });

  test("detects ownership collision with imported service", () => {
    const manifest: ServiceManifest = {
      name: "svc-managed",
      version: "1.0.0",
      hooks: [
        { id: "guard", on: "beforeToolExecution", command: "check-tool", tools: ["Write"] }
      ]
    };

    const lockfile: UhrLockfile = {
      lockfileVersion: 2,
      generatedAt: new Date().toISOString(),
      generatedBy: "uhr@0.1.0",
      platforms: ["claude-code"],
      installed: {
        "imported-claude-code": {
          version: "0.0.0",
          installedAt: new Date().toISOString(),
          integrity: "sha256-imported",
          source: "imported:claude-code",
          hooks: [
            { id: "existing-guard", on: "beforeToolExecution", command: "old-check", tools: ["Write"] }
          ],
          ownership: "imported"
        }
      },
      resolvedOrder: {},
      mergeMode: "preserve"
    };

    const conflicts = detectConflicts(manifest, lockfile);
    expect(conflicts.some((c) => c.type === "ownership_collision")).toBe(true);
    const collision = conflicts.find((c) => c.type === "ownership_collision");
    expect(collision?.severity).toBe("warning");
    expect(collision?.message).toContain("may override imported hook");
  });

  test("no ownership collision when installed service is not imported", () => {
    const manifest: ServiceManifest = {
      name: "svc-a",
      version: "1.0.0",
      hooks: [
        { id: "guard", on: "beforeToolExecution", command: "check-tool", tools: ["Write"] }
      ]
    };

    const lockfile: UhrLockfile = {
      lockfileVersion: 2,
      generatedAt: new Date().toISOString(),
      generatedBy: "uhr@0.1.0",
      platforms: ["claude-code"],
      installed: {
        "svc-b": {
          version: "1.0.0",
          installedAt: new Date().toISOString(),
          integrity: "sha256-abc",
          source: "local:/tmp/svc-b.json",
          hooks: [
            { id: "other-guard", on: "beforeToolExecution", command: "other-check", tools: ["Write"] }
          ],
          ownership: "uhr-managed"
        }
      },
      resolvedOrder: {},
      mergeMode: "strict"
    };

    const conflicts = detectConflicts(manifest, lockfile);
    expect(conflicts.some((c) => c.type === "ownership_collision")).toBe(false);
  });

  test("detects platform gap", () => {
    const manifest: ServiceManifest = {
      name: "multi-plat",
      version: "1.0.0",
      hooks: [
        { id: "start", on: "sessionStart", command: "init", platforms: ["claude-code", "cursor"] }
      ]
    };

    const lockfile: UhrLockfile = {
      lockfileVersion: 2,
      generatedAt: new Date().toISOString(),
      generatedBy: "uhr@0.1.0",
      platforms: ["claude-code"],
      installed: {},
      resolvedOrder: {},
      mergeMode: "strict"
    };

    const conflicts = detectConflicts(manifest, lockfile);
    expect(conflicts.some((c) => c.type === "platform_gap")).toBe(true);
    const gap = conflicts.find((c) => c.type === "platform_gap");
    expect(gap?.severity).toBe("warning");
    expect(gap?.message).toContain("cursor");
    expect(gap?.message).toContain("not in lockfile platforms");
  });

  test("no platform gap when all target platforms exist", () => {
    const manifest: ServiceManifest = {
      name: "multi-plat",
      version: "1.0.0",
      hooks: [
        { id: "start", on: "sessionStart", command: "init", platforms: ["claude-code"] }
      ]
    };

    const lockfile: UhrLockfile = {
      lockfileVersion: 2,
      generatedAt: new Date().toISOString(),
      generatedBy: "uhr@0.1.0",
      platforms: ["claude-code"],
      installed: {},
      resolvedOrder: {},
      mergeMode: "strict"
    };

    const conflicts = detectConflicts(manifest, lockfile);
    expect(conflicts.some((c) => c.type === "platform_gap")).toBe(false);
  });

  test("no platform gap when hook has no platform restrictions", () => {
    const manifest: ServiceManifest = {
      name: "universal",
      version: "1.0.0",
      hooks: [
        { id: "start", on: "sessionStart", command: "init" }
      ]
    };

    const lockfile: UhrLockfile = {
      lockfileVersion: 2,
      generatedAt: new Date().toISOString(),
      generatedBy: "uhr@0.1.0",
      platforms: ["claude-code"],
      installed: {},
      resolvedOrder: {},
      mergeMode: "strict"
    };

    const conflicts = detectConflicts(manifest, lockfile);
    expect(conflicts.some((c) => c.type === "platform_gap")).toBe(false);
  });

  test("no conflicts for compatible services", () => {
    const manifest: ServiceManifest = {
      name: "svc-a",
      version: "1.0.0",
      hooks: [
        { id: "start", on: "sessionStart", command: "init-a" }
      ]
    };

    const lockfile: UhrLockfile = {
      lockfileVersion: 2,
      generatedAt: new Date().toISOString(),
      generatedBy: "uhr@0.1.0",
      platforms: ["claude-code"],
      installed: {
        "svc-b": {
          version: "1.0.0",
          installedAt: new Date().toISOString(),
          integrity: "sha256-abc",
          source: "local:/tmp/svc-b.json",
          hooks: [
            { id: "stop", on: "stop", command: "cleanup-b" }
          ]
        }
      },
      resolvedOrder: {},
      mergeMode: "strict"
    };

    const conflicts = detectConflicts(manifest, lockfile);
    // Only shared_slot/info for different events = 0 conflicts
    expect(conflicts.filter((c) => c.severity === "error")).toHaveLength(0);
  });
});
