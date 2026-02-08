import path from "node:path";
import { mkdir } from "node:fs/promises";

export interface BackupEntry {
  timestamp: string;
  files: string[];
  createdAt: string;
  trigger: string;
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
  const file = Bun.file(indexPath(cwd));
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
  await mkdir(backupsDir(cwd), { recursive: true });
  await Bun.write(indexPath(cwd), JSON.stringify(index, null, 2) + "\n");
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

  for (const filepath of files) {
    const file = Bun.file(filepath);
    if (!(await file.exists())) {
      skippedFiles.push(filepath);
      continue;
    }

    const rel = path.relative(cwd, filepath);
    const dest = path.join(backupDir, rel);
    await mkdir(path.dirname(dest), { recursive: true });
    await Bun.write(dest, file);
    backedUpFiles.push(filepath);
    relPaths.push(rel);
  }

  const index = await readIndex(cwd);
  index.entries.push({
    timestamp,
    files: relPaths,
    createdAt: new Date().toISOString(),
    trigger,
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

  for (const rel of entry.files) {
    const src = path.join(backupDir, rel);
    const dest = path.join(cwd, rel);
    const file = Bun.file(src);
    if (!(await file.exists())) {
      continue;
    }
    await mkdir(path.dirname(dest), { recursive: true });
    await Bun.write(dest, file);
    restoredFiles.push(dest);
  }

  return { timestamp, restoredFiles };
}
