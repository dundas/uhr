import { describe, expect, test } from "bun:test";
import { topologicalSort } from "../src/ordering";

describe("topologicalSort", () => {
  test("returns deterministic order for acyclic graph", () => {
    const result = topologicalSort({
      "a/h1": ["b/h2"],
      "b/h2": ["c/h3"],
      "c/h3": []
    });

    expect(result).toEqual(["a/h1", "b/h2", "c/h3"]);
  });

  test("throws on cycles", () => {
    expect(() =>
      topologicalSort({
        a: ["b"],
        b: ["a"]
      })
    ).toThrow("Circular ordering detected");
  });
});
