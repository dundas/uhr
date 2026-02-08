import { describe, expect, test } from "bun:test";
import { computeIntegrity } from "../../src/util/integrity";

describe("computeIntegrity", () => {
  test("deterministic: same input produces same hash", async () => {
    const first = await computeIntegrity("hello world");
    const second = await computeIntegrity("hello world");
    expect(first).toBe(second);
  });

  test("output format matches sha256-<12 hex chars>", async () => {
    const result = await computeIntegrity("hello world");
    expect(result).toMatch(/^sha256-[a-f0-9]{12}$/);
  });

  test("different inputs produce different hashes", async () => {
    const a = await computeIntegrity("hello world");
    const b = await computeIntegrity("hello world!");
    expect(a).not.toBe(b);
  });
});
