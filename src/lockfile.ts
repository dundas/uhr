import path from "node:path";
import { mkdir } from "node:fs/promises";
import type { PlatformId, UhrLockfile } from "./types";

export type Scope = "user" | "project";

export function lockfilePathForScope(scope: Scope, cwd: string): string {
  if (scope === "project") {
    return path.join(cwd, ".uhr", "uhr.lock.json");
  }
  return path.join(process.env.HOME ?? "~", ".uhr", "uhr.lock.json");
}

export function createDefaultLockfile(platforms: PlatformId[] = ["claude-code"]): UhrLockfile {
  return {
    lockfileVersion: 1,
    generatedAt: new Date().toISOString(),
    generatedBy: "uhr@0.1.0",
    platforms,
    installed: {},
    resolvedOrder: {}
  };
}

export async function readLockfile(scope: Scope, cwd: string): Promise<UhrLockfile> {
  const filepath = lockfilePathForScope(scope, cwd);
  const file = Bun.file(filepath);

  if (!(await file.exists())) {
    return createDefaultLockfile();
  }

  const text = await file.text();
  return JSON.parse(text) as UhrLockfile;
}

export async function writeLockfile(scope: Scope, cwd: string, lockfile: UhrLockfile): Promise<string> {
  const filepath = lockfilePathForScope(scope, cwd);
  await mkdir(path.dirname(filepath), { recursive: true });
  await Bun.write(filepath, JSON.stringify(lockfile, null, 2) + "\n");
  return filepath;
}
