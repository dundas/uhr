import { describe, expect, test } from "bun:test";
import { permissionPatternsOverlap, toolsOverlap } from "../../src/util/patterns";

describe("permissionPatternsOverlap", () => {
  test("exact match returns true", () => {
    expect(permissionPatternsOverlap("Bash(npm test)", "Bash(npm test)")).toBe(true);
  });

  test("wildcard overlaps with specific body", () => {
    expect(permissionPatternsOverlap("Bash(*)", "Bash(npm test)")).toBe(true);
  });

  test("prefix wildcard overlaps with matching body", () => {
    expect(permissionPatternsOverlap("Bash(npm *)", "Bash(npm test)")).toBe(true);
  });

  test("different tools do not overlap", () => {
    expect(permissionPatternsOverlap("Bash(npm test)", "Read(file.ts)")).toBe(false);
  });

  test("different bodies do not overlap", () => {
    expect(permissionPatternsOverlap("Bash(npm test)", "Bash(yarn test)")).toBe(false);
  });
});

describe("toolsOverlap", () => {
  test("wildcard array overlaps with any tool", () => {
    expect(toolsOverlap(["*"], ["write"])).toBe(true);
  });

  test("undefined defaults to wildcard and overlaps", () => {
    expect(toolsOverlap(undefined, ["write"])).toBe(true);
  });

  test("disjoint tool arrays do not overlap", () => {
    expect(toolsOverlap(["bash"], ["write"])).toBe(false);
  });

  test("arrays with a common element overlap", () => {
    expect(toolsOverlap(["write", "bash"], ["write"])).toBe(true);
  });
});
