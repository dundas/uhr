import { afterEach, describe, expect, test, spyOn } from "bun:test";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runCli } from "../../src/cli";

let tmpDir: string | undefined;

afterEach(async () => {
  if (tmpDir) {
    await rm(tmpDir, { recursive: true, force: true });
    tmpDir = undefined;
  }
});

async function writeManifest(dir: string, manifest: Record<string, unknown>): Promise<string> {
  const filepath = path.join(dir, `${manifest.name}.uhr.json`);
  await Bun.write(filepath, JSON.stringify(manifest));
  return filepath;
}

const testManifest = {
  name: "test-svc",
  version: "1.0.0",
  hooks: [
    { id: "on-start", on: "sessionStart", command: "echo start" }
  ]
};

describe("uhr restore", () => {
  test("restore without timestamp lists available backups", async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "uhr-restore-test-"));

    // Init and install to create a backup
    await runCli(["init"], tmpDir);
    const manifestPath = await writeManifest(tmpDir, testManifest);
    await runCli(["install", manifestPath], tmpDir);

    const logSpy = spyOn(console, "log");
    const exitCode = await runCli(["restore"], tmpDir);
    const calls = logSpy.mock.calls.map((c) => String(c[0]));
    logSpy.mockRestore();

    expect(exitCode).toBe(0);
    const output = calls.join("\n");
    expect(output).toContain("Available backups:");
    expect(output).toContain("install");
  });

  test("restore with valid timestamp recovers prior config", async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "uhr-restore-test-"));

    // Write a manual settings.json
    const claudeDir = path.join(tmpDir, ".claude");
    await mkdir(claudeDir, { recursive: true });
    await Bun.write(path.join(claudeDir, "settings.json"), '{"manual":true}');

    // Init and install — this backs up the manual config, then overwrites it
    await runCli(["init"], tmpDir);
    const manifestPath = await writeManifest(tmpDir, testManifest);
    await runCli(["install", manifestPath], tmpDir);

    // Get the backup timestamp
    const indexPath = path.join(tmpDir, ".uhr", "backups", "index.json");
    const index = await Bun.file(indexPath).json();
    const installBackup = index.entries.find((e: { trigger: string }) => e.trigger === "install");
    expect(installBackup).toBeDefined();

    // Restore
    const exitCode = await runCli(["restore", installBackup.timestamp], tmpDir);
    expect(exitCode).toBe(0);

    // The manual config should be restored
    const content = await Bun.file(path.join(claudeDir, "settings.json")).text();
    expect(content).toBe('{"manual":true}');
  });

  test("restore with invalid timestamp fails gracefully", async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "uhr-restore-test-"));

    const errSpy = spyOn(console, "error");
    const exitCode = await runCli(["restore", "bad-timestamp"], tmpDir);
    const calls = errSpy.mock.calls.map((c) => String(c[0]));
    errSpy.mockRestore();

    expect(exitCode).toBe(1);
    const output = calls.join("\n");
    expect(output).toContain("No backup found");
  });

  test("no backups shows friendly message", async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "uhr-restore-test-"));

    const logSpy = spyOn(console, "log");
    const exitCode = await runCli(["restore"], tmpDir);
    const calls = logSpy.mock.calls.map((c) => String(c[0]));
    logSpy.mockRestore();

    expect(exitCode).toBe(0);
    const output = calls.join("\n");
    expect(output).toContain("No backups available.");
  });
});
