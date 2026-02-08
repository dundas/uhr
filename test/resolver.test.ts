import { describe, expect, test } from "bun:test";
import { resolveFromInstalled } from "../src/resolver";

describe("resolveFromInstalled", () => {
  test("applies runAfter ordering constraints", () => {
    const resolved = resolveFromInstalled({
      alpha: {
        version: "1.0.0",
        installedAt: "2026-02-07T00:00:00.000Z",
        integrity: "sha256-a",
        source: "local:/tmp/a.json",
        hooks: [
          {
            id: "first",
            on: "afterToolExecution",
            command: "echo alpha"
          }
        ]
      },
      beta: {
        version: "1.0.0",
        installedAt: "2026-02-07T00:00:01.000Z",
        integrity: "sha256-b",
        source: "local:/tmp/b.json",
        hooks: [
          {
            id: "second",
            on: "afterToolExecution",
            command: "echo beta"
          }
        ],
        ordering: {
          second: {
            runAfter: ["alpha/first"]
          }
        }
      }
    });

    expect(resolved.afterToolExecution).toEqual(["alpha/first", "beta/second"]);
  });
});
