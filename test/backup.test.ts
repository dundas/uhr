import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createBackup, listBackups, restoreBackup } from "../src/backup";

let tmpDir: string | undefined;

afterEach(async () => {
  if (tmpDir) {
    await rm(tmpDir, { recursive: true, force: true });
    tmpDir = undefined;
  }
});

describe("createBackup", () => {
  test("backs up existing files to timestamped directory", async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "uhr-backup-test-"));
    const settingsDir = path.join(tmpDir, ".claude");
    await mkdir(settingsDir, { recursive: true });
    const settingsPath = path.join(settingsDir, "settings.json");
    await Bun.write(settingsPath, '{"hooks":{}}');

    const result = await createBackup(tmpDir, [settingsPath], "rebuild");

    expect(result.backedUpFiles).toEqual([settingsPath]);
    expect(result.skippedFiles).toEqual([]);
    expect(result.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}/);

    // Verify backup file exists with original content
    const backupFile = path.join(tmpDir, ".uhr", "backups", result.timestamp, ".claude", "settings.json");
    const content = await Bun.file(backupFile).text();
    expect(content).toBe('{"hooks":{}}');
  });

  test("skips files that do not exist", async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "uhr-backup-test-"));
    const nonExistent = path.join(tmpDir, ".claude", "settings.json");

    const result = await createBackup(tmpDir, [nonExistent], "install");

    expect(result.backedUpFiles).toEqual([]);
    expect(result.skippedFiles).toEqual([nonExistent]);

    // Index should still have an entry
    const indexFile = path.join(tmpDir, ".uhr", "backups", "index.json");
    const index = JSON.parse(await Bun.file(indexFile).text());
    expect(index.entries).toHaveLength(1);
    expect(index.entries[0].files).toEqual([]);
  });

  test("backs up multiple files across platforms", async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "uhr-backup-test-"));

    const files = [
      path.join(tmpDir, ".claude", "settings.json"),
      path.join(tmpDir, ".cursor", "hooks.json"),
      path.join(tmpDir, ".gemini", "settings.json"),
    ];

    for (const f of files) {
      await mkdir(path.dirname(f), { recursive: true });
      await Bun.write(f, `{"source":"${path.basename(path.dirname(f))}"}`);
    }

    const result = await createBackup(tmpDir, files, "rebuild");

    expect(result.backedUpFiles).toHaveLength(3);
    expect(result.skippedFiles).toHaveLength(0);

    // Verify all three are backed up
    for (const f of files) {
      const rel = path.relative(tmpDir, f);
      const backupPath = path.join(tmpDir, ".uhr", "backups", result.timestamp, rel);
      expect(await Bun.file(backupPath).exists()).toBe(true);
    }
  });

  test("creates index.json on first backup", async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "uhr-backup-test-"));

    await createBackup(tmpDir, [], "rebuild");

    const indexFile = path.join(tmpDir, ".uhr", "backups", "index.json");
    expect(await Bun.file(indexFile).exists()).toBe(true);

    const index = JSON.parse(await Bun.file(indexFile).text());
    expect(index.version).toBe(1);
    expect(index.entries).toHaveLength(1);
  });

  test("appends to existing index on subsequent backups", async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "uhr-backup-test-"));

    await createBackup(tmpDir, [], "install");
    await new Promise((r) => setTimeout(r, 10)); // small delay for unique timestamp
    await createBackup(tmpDir, [], "rebuild");

    const indexFile = path.join(tmpDir, ".uhr", "backups", "index.json");
    const index = JSON.parse(await Bun.file(indexFile).text());
    expect(index.entries).toHaveLength(2);
    expect(index.entries[0].trigger).toBe("install");
    expect(index.entries[1].trigger).toBe("rebuild");
  });

  test("records trigger in backup entry", async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "uhr-backup-test-"));

    await createBackup(tmpDir, [], "uninstall");

    const indexFile = path.join(tmpDir, ".uhr", "backups", "index.json");
    const index = JSON.parse(await Bun.file(indexFile).text());
    expect(index.entries[0].trigger).toBe("uninstall");
  });
});

describe("listBackups", () => {
  test("returns empty array when no backups exist", async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "uhr-backup-test-"));

    const result = await listBackups(tmpDir);

    expect(result).toEqual([]);
  });

  test("returns entries sorted newest first", async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "uhr-backup-test-"));

    await createBackup(tmpDir, [], "first");
    await new Promise((r) => setTimeout(r, 10));
    await createBackup(tmpDir, [], "second");

    const result = await listBackups(tmpDir);

    expect(result).toHaveLength(2);
    expect(result[0].trigger).toBe("second");
    expect(result[1].trigger).toBe("first");
  });
});

describe("restoreBackup", () => {
  test("restores files from a specific timestamp", async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "uhr-backup-test-"));
    const settingsDir = path.join(tmpDir, ".claude");
    await mkdir(settingsDir, { recursive: true });
    const settingsPath = path.join(settingsDir, "settings.json");

    // Write original content and create backup
    await Bun.write(settingsPath, '{"original":true}');
    const backup = await createBackup(tmpDir, [settingsPath], "rebuild");

    // Overwrite with new content
    await Bun.write(settingsPath, '{"modified":true}');
    expect(await Bun.file(settingsPath).text()).toBe('{"modified":true}');

    // Restore
    const result = await restoreBackup(tmpDir, backup.timestamp);

    expect(result.restoredFiles).toHaveLength(1);
    expect(await Bun.file(settingsPath).text()).toBe('{"original":true}');
  });

  test("throws when timestamp is not found in index", async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "uhr-backup-test-"));

    expect(restoreBackup(tmpDir, "nonexistent")).rejects.toThrow(
      "No backup found for timestamp: nonexistent"
    );
  });

  test("restores only the files that were in the backup", async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "uhr-backup-test-"));
    const claudeDir = path.join(tmpDir, ".claude");
    await mkdir(claudeDir, { recursive: true });
    const claudePath = path.join(claudeDir, "settings.json");
    await Bun.write(claudePath, '{"claude":true}');

    // Backup only includes claude, not cursor
    const backup = await createBackup(tmpDir, [claudePath], "rebuild");

    const result = await restoreBackup(tmpDir, backup.timestamp);

    expect(result.restoredFiles).toHaveLength(1);
    expect(result.restoredFiles[0]).toBe(claudePath);

    // cursor should not exist
    const cursorPath = path.join(tmpDir, ".cursor", "hooks.json");
    expect(await Bun.file(cursorPath).exists()).toBe(false);
  });

  test("creates parent directories if missing during restore", async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "uhr-backup-test-"));
    const claudeDir = path.join(tmpDir, ".claude");
    await mkdir(claudeDir, { recursive: true });
    const settingsPath = path.join(claudeDir, "settings.json");
    await Bun.write(settingsPath, '{"backup":true}');

    const backup = await createBackup(tmpDir, [settingsPath], "rebuild");

    // Delete the entire .claude directory
    await rm(claudeDir, { recursive: true, force: true });
    expect(await Bun.file(settingsPath).exists()).toBe(false);

    // Restore should recreate it
    const result = await restoreBackup(tmpDir, backup.timestamp);

    expect(result.restoredFiles).toHaveLength(1);
    expect(await Bun.file(settingsPath).text()).toBe('{"backup":true}');
  });
});
