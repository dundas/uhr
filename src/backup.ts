import path from "node:path";
import { lstat, unlink } from "node:fs/promises";
import { assertSafeTarget, atomicWriteFile } from "./util/safe-fs";

export interface BackupEntry {
  timestamp: string;
  files: string[];
  createdAt: string;
  trigger: string;
  missingFiles?: string[];
}

export interface BackupIndex {
  version: 1;
  entries: BackupEntry[];
}

export interface BackupResult {
  timestamp: string;
  backedUpFiles: string[];
  skippedFiles: string[];
}

export interface RestoreResult {
  timestamp: string;
  restoredFiles: string[];
}

function backupsDir(cwd: string): string {
  return path.join(cwd, ".uhr", "backups");
}

function indexPath(cwd: string): string {
  return path.join(backupsDir(cwd), "index.json");
}

function makeTimestamp(): string {
  return new Date().toISOString().replace(/:/g, "-");
}

async function readIndex(cwd: string): Promise<BackupIndex> {
  const filepath = indexPath(cwd);
  await assertSafeTarget(cwd, filepath);
  const file = Bun.file(filepath);
  if (!(await file.exists())) {
    return { version: 1, entries: [] };
  }
  try {
    return JSON.parse(await file.text()) as BackupIndex;
  } catch {
    return { version: 1, entries: [] };
  }
}

async function writeIndex(cwd: string, index: BackupIndex): Promise<void> {
  await atomicWriteFile(cwd, indexPath(cwd), JSON.stringify(index, null, 2) + "\n");
}

const ALLOWED_BACKUP_PATHS = new Set([
  ".claude/settings.json",
  ".codex/hooks.json",
  ".cursor/hooks.json",
  ".gemini/settings.json",
  ".uhr/generated/codex.json"
]);

function safeRelativePath(cwd: string, filepath: string): string {
  const rel = path.relative(path.resolve(cwd), path.resolve(filepath));
  if (!ALLOWED_BACKUP_PATHS.has(rel)) {
    throw new Error(`Unsafe or unsupported backup target: ${filepath}`);
  }
  return rel;
}

async function currentCodexOwnership(cwd: string): Promise<unknown | undefined> {
  const ownershipPath = path.join(cwd, ".uhr", "generated", "codex.json");
  await assertSafeTarget(cwd, ownershipPath);
  const file = Bun.file(ownershipPath);
  if (!(await file.exists())) return undefined;

  try {
    const sourceStat = await lstat(ownershipPath);
    if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) return undefined;
    const record = JSON.parse(await file.text()) as { version?: number; platform?: string; target?: string; content?: unknown };
    if (record.version !== 1 || record.platform !== "codex" || record.target !== ".codex/hooks.json") return undefined;
    return record.content;
  } catch {
    return undefined;
  }
}

async function removeCodexConfigIfOwned(cwd: string, expected: unknown): Promise<void> {
  const filepath = path.join(cwd, ".codex", "hooks.json");
  await assertSafeTarget(cwd, filepath);
  const file = Bun.file(filepath);
  if (!(await file.exists())) return;

  const sourceStat = await lstat(filepath);
  if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) return;
  let actual: unknown;
  try {
    actual = JSON.parse(await file.text()) as unknown;
  } catch {
    return;
  }
  if (JSON.stringify(actual) !== JSON.stringify(expected)) return;
  try {
    await unlink(filepath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

export async function createBackup(
  cwd: string,
  files: string[],
  trigger: string
): Promise<BackupResult> {
  const timestamp = makeTimestamp();
  const backupDir = path.join(backupsDir(cwd), timestamp);
  const backedUpFiles: string[] = [];
  const skippedFiles: string[] = [];
  const relPaths: string[] = [];
  const missingFiles: string[] = [];

  for (const filepath of files) {
    const rel = safeRelativePath(cwd, filepath);
    await assertSafeTarget(cwd, filepath);
    const file = Bun.file(filepath);
    if (!(await file.exists())) {
      skippedFiles.push(filepath);
      missingFiles.push(rel);
      continue;
    }

    const sourceStat = await lstat(filepath);
    if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) {
      throw new Error(`Unsafe backup source (must be a regular file): ${filepath}`);
    }
    const dest = path.join(backupDir, rel);
    await atomicWriteFile(cwd, dest, new Uint8Array(await file.arrayBuffer()), sourceStat.mode & 0o777, false);
    backedUpFiles.push(filepath);
    relPaths.push(rel);
  }

  const index = await readIndex(cwd);
  index.entries.push({
    timestamp,
    files: relPaths,
    createdAt: new Date().toISOString(),
    trigger,
    missingFiles,
  });
  await writeIndex(cwd, index);

  return { timestamp, backedUpFiles, skippedFiles };
}

export async function listBackups(cwd: string): Promise<BackupEntry[]> {
  const index = await readIndex(cwd);
  return [...index.entries].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

export async function restoreBackup(
  cwd: string,
  timestamp: string
): Promise<RestoreResult> {
  const index = await readIndex(cwd);
  const entry = index.entries.find((e) => e.timestamp === timestamp);
  if (!entry) {
    throw new Error(`No backup found for timestamp: ${timestamp}`);
  }

  const backupDir = path.join(backupsDir(cwd), timestamp);
  const restoredFiles: string[] = [];
  const codexOwnership = entry.missingFiles?.includes(".codex/hooks.json")
    ? await currentCodexOwnership(cwd)
    : undefined;

  for (const rel of entry.files) {
    if (!ALLOWED_BACKUP_PATHS.has(rel)) {
      throw new Error(`Unsafe or unsupported path in backup index: ${rel}`);
    }
    const src = path.join(backupDir, rel);
    const dest = path.join(cwd, rel);
    await assertSafeTarget(cwd, src);
    await assertSafeTarget(cwd, dest);
    const file = Bun.file(src);
    if (!(await file.exists())) {
      continue;
    }
    const sourceStat = await lstat(src);
    if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) {
      throw new Error(`Unsafe backup file (must be a regular file): ${src}`);
    }
    await atomicWriteFile(cwd, dest, new Uint8Array(await file.arrayBuffer()), sourceStat.mode & 0o777, false);
    restoredFiles.push(dest);
  }

  for (const rel of entry.missingFiles ?? []) {
    if (rel === ".codex/hooks.json") {
      if (codexOwnership !== undefined) await removeCodexConfigIfOwned(cwd, codexOwnership);
      continue;
    }
    if (!rel.startsWith(".uhr/generated/") || !ALLOWED_BACKUP_PATHS.has(rel)) continue;
    const dest = path.join(cwd, rel);
    await assertSafeTarget(cwd, dest);
    await unlink(dest).catch((error) => {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    });
  }

  return { timestamp, restoredFiles };
}
