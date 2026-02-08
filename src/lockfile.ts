import path from "node:path";
import { mkdir } from "node:fs/promises";
import type {
  HookOwnership,
  HookSourceType,
  LegacyUhrLockfileV1,
  PlatformId,
  UhrLockfile
} from "./types";

export type Scope = "user" | "project";

function defaultOwnership(): HookOwnership {
  return "uhr-managed";
}

function defaultSourceType(): HookSourceType {
  return "uhr-service";
}

function normalizePlatforms(platforms: PlatformId[] | undefined): PlatformId[] {
  if (!platforms || platforms.length === 0) {
    return ["claude-code"];
  }
  return Array.from(new Set(platforms));
}

function upgradeV1ToV2(lockfile: LegacyUhrLockfileV1): UhrLockfile {
  const installed: UhrLockfile["installed"] = {};

  for (const [name, service] of Object.entries(lockfile.installed ?? {})) {
    installed[name] = {
      ...service,
      ownership: service.ownership ?? defaultOwnership(),
      sourceType: service.sourceType ?? defaultSourceType(),
      sourcePlatform: service.sourcePlatform ?? null
    };
  }

  return {
    lockfileVersion: 2,
    generatedAt: lockfile.generatedAt ?? new Date().toISOString(),
    generatedBy: lockfile.generatedBy ?? "uhr@0.1.0",
    platforms: normalizePlatforms(lockfile.platforms),
    installed,
    resolvedOrder: lockfile.resolvedOrder ?? {},
    mergeMode: "strict"
  };
}

function normalizeV2(lockfile: Partial<UhrLockfile>): UhrLockfile {
  const installed: UhrLockfile["installed"] = {};

  for (const [name, service] of Object.entries(lockfile.installed ?? {})) {
    installed[name] = {
      ...service,
      ownership: service.ownership ?? defaultOwnership(),
      sourceType: service.sourceType ?? defaultSourceType(),
      sourcePlatform: service.sourcePlatform ?? null
    };
  }

  return {
    lockfileVersion: 2,
    generatedAt: lockfile.generatedAt ?? new Date().toISOString(),
    generatedBy: lockfile.generatedBy ?? "uhr@0.1.0",
    platforms: normalizePlatforms(lockfile.platforms),
    installed,
    resolvedOrder: lockfile.resolvedOrder ?? {},
    mergeMode: lockfile.mergeMode ?? "strict"
  };
}

export function lockfilePathForScope(scope: Scope, cwd: string): string {
  if (scope === "project") {
    return path.join(cwd, ".uhr", "uhr.lock.json");
  }
  return path.join(process.env.HOME ?? "~", ".uhr", "uhr.lock.json");
}

export function createDefaultLockfile(platforms: PlatformId[] = ["claude-code"]): UhrLockfile {
  return {
    lockfileVersion: 2,
    generatedAt: new Date().toISOString(),
    generatedBy: "uhr@0.1.0",
    platforms: normalizePlatforms(platforms),
    installed: {},
    resolvedOrder: {},
    mergeMode: "strict"
  };
}

export async function readLockfile(scope: Scope, cwd: string): Promise<UhrLockfile> {
  const filepath = lockfilePathForScope(scope, cwd);
  const file = Bun.file(filepath);

  if (!(await file.exists())) {
    return createDefaultLockfile();
  }

  const text = await file.text();
  const parsed = JSON.parse(text) as Partial<UhrLockfile> | LegacyUhrLockfileV1;

  if ((parsed as LegacyUhrLockfileV1).lockfileVersion === 1) {
    return upgradeV1ToV2(parsed as LegacyUhrLockfileV1);
  }

  return normalizeV2(parsed as Partial<UhrLockfile>);
}

export async function writeLockfile(scope: Scope, cwd: string, lockfile: UhrLockfile): Promise<string> {
  const filepath = lockfilePathForScope(scope, cwd);
  await mkdir(path.dirname(filepath), { recursive: true });
  const normalized = normalizeV2(lockfile);
  await Bun.write(filepath, JSON.stringify(normalized, null, 2) + "\n");
  return filepath;
}
