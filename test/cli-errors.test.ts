import { describe, expect, test, beforeEach, afterEach, spyOn } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { validateManifest, loadManifest } from "../src/manifest";
import { runCli } from "../src/cli";

// ──────────────────────────────────────────────────────────────────────
// Task 6.1 — Invalid Manifest Tests (ERR1)
// ──────────────────────────────────────────────────────────────────────

describe("invalid manifest inputs", () => {
  test("empty object throws with message about missing name", () => {
    expect(() => validateManifest({})).toThrow("name must be a non-empty string");
  });

  test("blocking and background hook throws", () => {
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
            background: true,
          },
        ],
      })
    ).toThrow("cannot be both blocking and background");
  });

  test("non-existent file rejects with file-not-found error", async () => {
    await expect(
      loadManifest("/nonexistent/path.json", "/tmp")
    ).rejects.toThrow();
  });

  test("invalid JSON file rejects with parse error", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "uhr-err-"));
    const badJsonPath = path.join(tempDir, "broken.json");
    await writeFile(badJsonPath, "{broken", "utf8");

    await expect(loadManifest(badJsonPath, tempDir)).rejects.toThrow();
  });

  // Additional edge cases for completeness

  test("null input throws manifest must be an object", () => {
    expect(() => validateManifest(null)).toThrow("manifest must be an object");
  });

  test("array input throws manifest must be an object", () => {
    expect(() => validateManifest([])).toThrow("manifest must be an object");
  });

  test("missing version throws", () => {
    expect(() =>
      validateManifest({
        name: "valid-name",
        hooks: [],
      })
    ).toThrow("version must be a non-empty string");
  });

  test("invalid name format throws", () => {
    expect(() =>
      validateManifest({
        name: "INVALID_NAME",
        version: "1.0.0",
        hooks: [],
      })
    ).toThrow("name must be lowercase and hyphen-separated");
  });

  test("hooks must be an array", () => {
    expect(() =>
      validateManifest({
        name: "valid-name",
        version: "1.0.0",
        hooks: "not-an-array",
      })
    ).toThrow("hooks must be an array");
  });

  test("duplicate hook ids throws", () => {
    expect(() =>
      validateManifest({
        name: "dup-hooks",
        version: "1.0.0",
        hooks: [
          { id: "same-id", on: "stop", command: "echo a" },
          { id: "same-id", on: "stop", command: "echo b" },
        ],
      })
    ).toThrow("duplicate hook id: same-id");
  });

  test("unsupported event throws", () => {
    expect(() =>
      validateManifest({
        name: "bad-event",
        version: "1.0.0",
        hooks: [{ id: "h1", on: "nonExistentEvent", command: "echo" }],
      })
    ).toThrow("unsupported event");
  });

  test("negative timeout throws", () => {
    expect(() =>
      validateManifest({
        name: "bad-timeout",
        version: "1.0.0",
        hooks: [
          { id: "h1", on: "stop", command: "echo", timeout: -5 },
        ],
      })
    ).toThrow("timeout must be a positive number");
  });
});

// ──────────────────────────────────────────────────────────────────────
// Task 6.2 — CLI Error Handling Tests (ERR2)
// ──────────────────────────────────────────────────────────────────────

describe("CLI error handling", () => {
  let consoleErrorSpy: ReturnType<typeof spyOn>;
  let consoleLogSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    // Suppress console output during tests to keep output clean
    consoleErrorSpy = spyOn(console, "error").mockImplementation(() => {});
    consoleLogSpy = spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    consoleLogSpy.mockRestore();
  });

  test("unknown command returns exit code 1", async () => {
    const exitCode = await runCli(["foobar"]);
    expect(exitCode).toBe(1);
  });

  test("unknown command prints error message", async () => {
    await runCli(["foobar"]);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("foobar")
    );
  });

  test("missing required argument for install returns exit code 1", async () => {
    const exitCode = await runCli(["install"]);
    expect(exitCode).toBe(1);
  });

  test("missing required argument for install prints usage", async () => {
    await runCli(["install"]);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Usage")
    );
  });

  test("unknown flag returns exit code 1", async () => {
    const exitCode = await runCli(["install", "foo.json", "--unknown"]);
    expect(exitCode).toBe(1);
  });

  test("unknown flag prints error about the flag", async () => {
    await runCli(["install", "foo.json", "--unknown"]);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("--unknown")
    );
  });

  test("invalid platform returns exit code 1", async () => {
    const exitCode = await runCli(["init", "--platforms=foo"]);
    expect(exitCode).toBe(1);
  });

  test("invalid platform prints unsupported platform message", async () => {
    await runCli(["init", "--platforms=foo"]);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Unsupported platform")
    );
  });

  // Additional CLI error edge cases

  test("missing required argument for uninstall returns exit code 1", async () => {
    const exitCode = await runCli(["uninstall"]);
    expect(exitCode).toBe(1);
  });

  test("missing required argument for check returns exit code 1", async () => {
    const exitCode = await runCli(["check"]);
    expect(exitCode).toBe(1);
  });

  test("missing required argument for diff returns exit code 1", async () => {
    const exitCode = await runCli(["diff"]);
    expect(exitCode).toBe(1);
  });

  test("missing required argument for update returns exit code 1", async () => {
    const exitCode = await runCli(["update"]);
    expect(exitCode).toBe(1);
  });

  test("missing value for --platforms flag returns exit code 1", async () => {
    const exitCode = await runCli(["install", "foo.json", "--platforms"]);
    expect(exitCode).toBe(1);
  });

  test("--help returns exit code 0", async () => {
    const exitCode = await runCli(["--help"]);
    expect(exitCode).toBe(0);
  });

  test("no command returns exit code 0 (shows help)", async () => {
    const exitCode = await runCli([]);
    expect(exitCode).toBe(0);
  });
});
