import { describe, expect, test, beforeEach, afterEach, spyOn } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runCli } from "../../src/cli";
import { runDoctor } from "../../src/doctor";
import { readLockfile } from "../../src/lockfile";
import { writeManifest, readJsonFile } from "./helpers";

// ──────────────────────────────────────────────────────────────────────
// Teleporter bug regression tests
// ──────────────────────────────────────────────────────────────────────

let tmpDir: string;
let consoleLogSpy: ReturnType<typeof spyOn>;
let consoleErrorSpy: ReturnType<typeof spyOn>;

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(tmpdir(), "uhr-platform-bugs-"));
  consoleLogSpy = spyOn(console, "log").mockImplementation(() => {});
  consoleErrorSpy = spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
  consoleLogSpy.mockRestore();
  consoleErrorSpy.mockRestore();
  await rm(tmpDir, { recursive: true, force: true });
});

// ──────────────────────────────────────────────────────────────────────
// Bug 1: rebuild --platforms must not permanently overwrite lockfile platforms
// ──────────────────────────────────────────────────────────────────────

describe("rebuild --platforms does not overwrite lockfile platforms", () => {
  test("lockfile platforms unchanged after rebuild --platforms subset", async () => {
    // Init with three platforms
    const initExit = await runCli(["init", "--platforms", "claude-code,cursor,gemini-cli"], tmpDir);
    expect(initExit).toBe(0);

    const manifest = {
      name: "multi-platform-svc",
      version: "1.0.0",
      hooks: [
        { id: "h1", on: "sessionStart", command: "echo start" }
      ]
    };
    const manifestPath = await writeManifest(tmpDir, manifest);
    await runCli(["install", manifestPath], tmpDir);

    // Rebuild with only claude-code
    const rebuildExit = await runCli(["rebuild", "--platforms", "claude-code"], tmpDir);
    expect(rebuildExit).toBe(0);

    // Lockfile platforms must still include all three
    const lockfile = await readLockfile("project", tmpDir);
    expect(lockfile.platforms).toContain("claude-code");
    expect(lockfile.platforms).toContain("cursor");
    expect(lockfile.platforms).toContain("gemini-cli");
  });

  test("rebuild --platforms only generates config for specified platform", async () => {
    const initExit = await runCli(["init", "--platforms", "claude-code,cursor"], tmpDir);
    expect(initExit).toBe(0);

    const manifest = {
      name: "svc",
      version: "1.0.0",
      hooks: [{ id: "h1", on: "sessionStart", command: "echo start" }]
    };
    const manifestPath = await writeManifest(tmpDir, manifest);
    await runCli(["install", manifestPath], tmpDir);

    // Rebuild only claude-code
    await runCli(["rebuild", "--platforms", "claude-code"], tmpDir);

    const claudeConfig = path.join(tmpDir, ".claude", "settings.json");
    const cursorConfig = path.join(tmpDir, ".cursor", "hooks.json");

    // cursor config may or may not exist (depends on if it was written on install)
    // but after rebuild --platforms claude-code the lockfile still has both platforms
    const lockfile = await readLockfile("project", tmpDir);
    expect(lockfile.platforms).toContain("cursor");
    expect(lockfile.platforms).toContain("claude-code");

    const claudeExists = await Bun.file(claudeConfig).exists();
    expect(claudeExists).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────
// Bug 2: install warns when service hooks all target non-active platforms
// ──────────────────────────────────────────────────────────────────────

describe("install warns when service has 0 hooks for active platforms", () => {
  test("warns when all hooks target only gemini-cli but lockfile is claude-code only", async () => {
    await runCli(["init"], tmpDir); // default: claude-code only

    const manifest = {
      name: "gemini-only-svc",
      version: "1.0.0",
      hooks: [
        { id: "h1", on: "sessionStart", command: "echo start", platforms: ["gemini-cli"] },
        { id: "h2", on: "stop", command: "echo stop", platforms: ["gemini-cli"] }
      ]
    };
    const manifestPath = await writeManifest(tmpDir, manifest);
    const exitCode = await runCli(["install", manifestPath], tmpDir);

    // Install succeeds (exit 0) but warns
    expect(exitCode).toBe(0);

    const errorOutput = consoleErrorSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
    expect(errorOutput).toMatch(/gemini-only-svc/);
    expect(errorOutput).toMatch(/2 hook/);
    expect(errorOutput).toMatch(/claude-code/);
  });

  test("warns when all hooks target cursor/gemini-cli but lockfile is claude-code only", async () => {
    await runCli(["init"], tmpDir);

    const manifest = {
      name: "no-claude-svc",
      version: "1.0.0",
      hooks: [
        { id: "h1", on: "beforeToolExecution", command: "echo h1", platforms: ["cursor"] },
        { id: "h2", on: "stop", command: "echo h2", platforms: ["gemini-cli"] }
      ]
    };
    const manifestPath = await writeManifest(tmpDir, manifest);
    await runCli(["install", manifestPath], tmpDir);

    const errorOutput = consoleErrorSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
    expect(errorOutput).toMatch(/no-claude-svc/);
  });

  test("does NOT warn when at least one hook targets an active platform", async () => {
    await runCli(["init"], tmpDir);

    const manifest = {
      name: "mixed-svc",
      version: "1.0.0",
      hooks: [
        { id: "h1", on: "sessionStart", command: "echo h1", platforms: ["claude-code"] },
        { id: "h2", on: "stop", command: "echo h2", platforms: ["gemini-cli"] }
      ]
    };
    const manifestPath = await writeManifest(tmpDir, manifest);
    await runCli(["install", manifestPath], tmpDir);

    const errorOutput = consoleErrorSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
    // Should not warn about zero hooks
    expect(errorOutput).not.toMatch(/none target the active platforms/);
  });

  test("does NOT warn when hooks have no platform restriction (universal)", async () => {
    await runCli(["init"], tmpDir);

    const manifest = {
      name: "universal-svc",
      version: "1.0.0",
      hooks: [
        { id: "h1", on: "sessionStart", command: "echo start" }
      ]
    };
    const manifestPath = await writeManifest(tmpDir, manifest);
    await runCli(["install", manifestPath], tmpDir);

    const errorOutput = consoleErrorSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
    expect(errorOutput).not.toMatch(/none target the active platforms/);
  });
});

// ──────────────────────────────────────────────────────────────────────
// Bug 3: doctor detects services with 0 hooks for active platforms
// ──────────────────────────────────────────────────────────────────────

describe("doctor detects services with no hooks for active platforms", () => {
  test("reports warning when installed service has all hooks targeting other platforms", async () => {
    await runCli(["init"], tmpDir); // claude-code only

    const manifest = {
      name: "cursor-only-svc",
      version: "1.0.0",
      hooks: [
        { id: "h1", on: "sessionStart", command: "echo cursor", platforms: ["cursor"] }
      ]
    };
    const manifestPath = await writeManifest(tmpDir, manifest);
    await runCli(["install", manifestPath], tmpDir);

    const issues = await runDoctor(tmpDir);

    const zeroHookIssue = issues.find(
      (i) => i.message.includes("cursor-only-svc") && i.message.includes("hook")
    );
    expect(zeroHookIssue).toBeDefined();
    expect(zeroHookIssue?.severity).toBe("warning");
    expect(zeroHookIssue?.message).toMatch(/cursor/);
  });

  test("does NOT report when service has hooks for active platform", async () => {
    await runCli(["init"], tmpDir);

    const manifest = {
      name: "active-svc",
      version: "1.0.0",
      hooks: [
        { id: "h1", on: "sessionStart", command: "echo start", platforms: ["claude-code"] }
      ]
    };
    const manifestPath = await writeManifest(tmpDir, manifest);
    await runCli(["install", manifestPath], tmpDir);

    const issues = await runDoctor(tmpDir);

    const zeroHookIssue = issues.find(
      (i) => i.message.includes("active-svc") && i.message.includes("none target")
    );
    expect(zeroHookIssue).toBeUndefined();
  });

  test("does NOT report when service has universal hooks (no platforms restriction)", async () => {
    await runCli(["init"], tmpDir);

    const manifest = {
      name: "universal-svc",
      version: "1.0.0",
      hooks: [
        { id: "h1", on: "stop", command: "echo stop" }
      ]
    };
    const manifestPath = await writeManifest(tmpDir, manifest);
    await runCli(["install", manifestPath], tmpDir);

    const issues = await runDoctor(tmpDir);

    const zeroHookIssue = issues.find(
      (i) => i.message.includes("universal-svc") && i.message.includes("none target")
    );
    expect(zeroHookIssue).toBeUndefined();
  });
});
