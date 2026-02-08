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

  test("malformed input without parentheses falls back to string equality", () => {
    expect(permissionPatternsOverlap("invalid", "Bash(test)")).toBe(false);
  });

  test("empty parentheses returns null from parser and falls back to string equality", () => {
    // Bash() has an empty body after trim, so parsePermissionPattern returns null.
    // Falls back to a === b, which is false since the strings differ.
    expect(permissionPatternsOverlap("Bash()", "Bash(test)")).toBe(false);
  });

  test("both wildcards with overlapping prefixes return true", () => {
    // "npm " starts with "npm " and vice versa — one prefix starts with the other
    expect(permissionPatternsOverlap("Bash(npm *)", "Bash(npm install *)")).toBe(true);
  });

  test("symmetry: specific body overlaps with wildcard prefix regardless of order", () => {
    // Reverse of existing "prefix wildcard overlaps with matching body" test
    expect(permissionPatternsOverlap("Bash(npm test)", "Bash(npm *)")).toBe(true);
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

  test("both undefined defaults to wildcard and overlaps", () => {
    expect(toolsOverlap(undefined, undefined)).toBe(true);
  });

  test("both empty arrays default to wildcard and overlap", () => {
    expect(toolsOverlap([], [])).toBe(true);
  });
});
